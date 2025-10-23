/**
 * ScriptCore Universal Auto-Binder (use(clazz) version) — Fully GraalVM-free
 * Safely resolves Java classes, supports commands, events, scheduler, and item creation.
 * * **DEFINITIVE FIX:** Replaced unreliable InventoryClick navigation with command-based navigation.
 * * - Admin Command: /pvault <player> [page]
 * * - User Command: /vault [page]
 * * - Removed InventoryClickEvent and all glass pane logic.
 * --- PlayerVaults Logic Starts Below ---
 */

// ---------- Logger Utilities ----------
function getPlugin() {
    try { return plugin; } catch { return null; }
}

function log(msg) {
    try { getPlugin()?.getLogger().info(String(msg)); }
    catch { if (typeof print !== 'undefined') print("[ScriptCore] " + msg); }
}

function warn(msg) {
    try { getPlugin()?.getLogger().warning(String(msg)); }
    catch { if (typeof print !== 'undefined') print("[ScriptCore:WARN] " + msg); }
}

function error(e) {
    const msg = e?.stack || String(e);
    try { getPlugin()?.getLogger().severe(msg); }
    catch { if (typeof print !== 'undefined') print("[ScriptCore:ERR] " + msg); }
}

function safe(fn) { try { return fn(); } catch (e) { error(e); } }

// ---------- Class Cache + Resolver ----------
const _ClassCache = {};
const _CommonPackages = [
    "org.bukkit.",
    "org.bukkit.entity.", 
    "org.bukkit.inventory.",
    "org.bukkit.event.",
    "org.bukkit.event.player.",
    "org.bukkit.persistence.",
    "net.kyori.adventure.text.",
    "net.kyori.adventure.text.format.",
    "net.kyori.adventure.text.serializer.plain.",
    "java.util.",
    "java.lang.",
    "java.util.regex."
];

function use(clazz) {
    if (_ClassCache[clazz]) return _ClassCache[clazz];

    try {
        const type = Java.type(clazz);
        _ClassCache[clazz] = type;
        return type;
    } catch {}

    for (const prefix of _CommonPackages) {
        try {
            const type = Java.type(prefix + clazz);
            _ClassCache[clazz] = type;
            return type;
        } catch {}
    }

    warn(`[ScriptCore] Failed to bind ${clazz}`);
    return null;
}

// ---------- Common Shortcuts (Bound Classes) ----------
const Bukkit = use("Bukkit");
const Material = use("Material");
const Player = use("Player");
const ItemStack = use("ItemStack");
const NamespacedKey = use("NamespacedKey");
const PersistentDataType = use("PersistentDataType");

// Adventure API
const Component = use("Component");
const NamedTextColor = use("NamedTextColor");
const PlainTextComponentSerializer = use("PlainTextComponentSerializer");

// Java Utilities
const Base64 = use("Base64");
const Pattern = use("Pattern");
const Iterator = use("Iterator");
const ArrayList = use("ArrayList");

// Use global Command and Event stubs
const Command = globalThis.Command ?? {
    register: (name, fn) => warn(`[ScriptCore] Command helper unavailable, ignored: ${name}`)
};
const Event = globalThis.Event ?? {
    on: (evt, fn) => warn(`[ScriptCore] Event helper unavailable, ignored: ${evt}`)
};
const Scheduler = globalThis.Scheduler ?? {
    runTask: (fn) => warn(`[ScriptCore] Scheduler helper unavailable, ignored runTask`),
    runTaskTimer: (fn, delay, period) => warn(`[ScriptCore] Scheduler helper unavailable, ignored runTaskTimer`),
    runTaskAsync: (fn) => warn(`[ScriptCore] Scheduler helper unavailable, ignored runTaskAsync`)
};

// ---------- JS Array → Java List Helper (Required for serialization) ----------
function javaList(arr) {
    const list = new ArrayList();
    for (let i = 0; i < arr.length; i++) {
        // Must add all elements, including nulls, to represent the 54 slots correctly for serialization
        if (arr[i] !== undefined) { 
             list.add(arr[i]);
        } else {
             list.add(null);
        }
    }
    return list;
}

// ---------- Constants for PlayerVaults Logic ----------
const INVENTORY_SIZE = 54;
const VAULT_TITLE_PREFIX = "Vault - Page ";
const REGEX_PERMISSION = "playervault\\.amount\\.(\\d+)"; 


// ========================================================
// ------------------- PlayerVaults Utilities ------------------
// ========================================================

function sendMessage(sender, msg, color) {
    const textComponent = Component.text(String(msg), color || NamedTextColor.RED); 
    sender.sendMessage(textComponent);
}

function getPageNumber(plainTitle) {
    try {
        if (!plainTitle.startsWith(VAULT_TITLE_PREFIX)) return 1;
        
        const pageString = plainTitle.replace(VAULT_TITLE_PREFIX, "").trim();
        return parseInt(pageString, 10);
    } catch (e) {
        return 1;
    }
}

function getKeyForPage(page) {
    return new NamespacedKey(getPlugin(), "vault_page_" + page);
}

function getVaultLimit(player) {
    const pattern = Pattern.compile(REGEX_PERMISSION);
    let max = 1;

    const effectivePerms = player.getEffectivePermissions();
    const iterator = effectivePerms.iterator();

    while (iterator.hasNext()) {
        const permAttachment = iterator.next();
        
        const perm = permAttachment.getPermission();
        if (!perm) continue; 
        
        const matcher = pattern.matcher(perm);
        if (matcher.matches()) {
            try {
                const n = parseInt(matcher.group(1), 10);
                if (n > max) max = n;
            } catch (e) {}
        }
    }
    return max;
}


// ========================================================
// ------------------- Storage System ---------------------
// ========================================================

function saveToStorage(player, contents, page) {
    return safe(() => {
        const list = javaList(contents); 
        const data = ItemStack.serializeItemsAsBytes(list); 
        const encoded = Base64.getEncoder().encodeToString(data);
        
        player.getPersistentDataContainer().set(getKeyForPage(page), PersistentDataType.STRING, encoded);
        log(`[Vault] Saved page ${page} for ${player.getName()}.`);
    });
}

function loadFromStorage(player, page) {
    const emptyInventory = Java.to(new Array(INVENTORY_SIZE).fill(null), ItemStack["[]"]);
    
    return safe(() => {
        const key = getKeyForPage(page);
        if (!player.getPersistentDataContainer().has(key, PersistentDataType.STRING)) {
            return emptyInventory;
        }

        const encoded = player.getPersistentDataContainer().get(key, PersistentDataType.STRING);
        
        if (encoded === null || encoded.length === 0) return emptyInventory;

        const data = Base64.getDecoder().decode(encoded);
        const items = ItemStack.deserializeItemsFromBytes(data); 

        const array = Java.to(new Array(INVENTORY_SIZE).fill(null), ItemStack["[]"]);
        
        for (let i = 0; i < Math.min(array.length, items.length); i++) {
            array[i] = items[i];
        }
        
        return array;
    }) || emptyInventory; 
}


// ========================================================
// ------------------- Vault Logic / Command / Events ------------------------
// ========================================================

function openVault(opener, target, page, max) {
    const title = Component.text(VAULT_TITLE_PREFIX + page, NamedTextColor.GRAY);
    // Note: Inventory size remains 54, but no nav items are added (slots 45, 53 are usable)
    const vault = Bukkit.createInventory(null, INVENTORY_SIZE, title); 
    
    vault.setContents(loadFromStorage(target, page));
    
    opener.openInventory(vault);
}

// ----------------------------------------------------
// COMMAND: /vault [page] (Standard User Command)
// ----------------------------------------------------
Command.register("vault", (sender, args) => safe(() => {
    
    if (!(sender instanceof Player)) {
        return sendMessage(sender, "This command is player-only.", NamedTextColor.RED);
    }
    
    let player = sender; 
    let target = sender; // User always targets self
    let page = 1;

    // Argument Parsing: args[0] is an optional page number
    if (args?.length >= 1) {
        try {
            page = Math.max(1, parseInt(args[0], 10));
        } catch (e) {
            return sendMessage(player, "Invalid vault page number. Usage: /vault [page]", NamedTextColor.RED);
        }
    }

    const max = getVaultLimit(target);
    if (page > max) {
        return sendMessage(player, 
            `You only have access to ${max} vaults.`, 
            NamedTextColor.RED
        );
    }

    openVault(player, target, page, max);
}));

// ----------------------------------------------------
// COMMAND: /pvault <player> [page] (Admin Command)
// ----------------------------------------------------
Command.register("pvault", (sender, args) => safe(() => {
    
    if (!(sender instanceof Player)) {
        // Allow console or command blocks to use /pvault if needed, but still requires target player argument
        if (args?.length < 1) {
            return sendMessage(sender, "Usage: /pvault <player> [page]", NamedTextColor.RED);
        }
    }
    
    let opener = sender;
    
    if (!opener.hasPermission("playervaults.admin")) {
        return sendMessage(opener, "You do not have permission to use /pvault.", NamedTextColor.RED);
    }
    
    // Admin command REQUIRES a player argument
    if (args?.length < 1) {
        return sendMessage(opener, "Usage: /pvault <player> [page]", NamedTextColor.RED);
    }

    let target = Bukkit.getPlayerExact(args[0]);
    if (!target) {
        return sendMessage(opener, `Player '${args[0]}' not found.`, NamedTextColor.RED);
    }

    let page = 1;
    if (args.length >= 2) {
        try {
            page = Math.max(1, parseInt(args[1], 10));
        } catch (e) {
            return sendMessage(opener, "Invalid vault page number.", NamedTextColor.RED);
        }
    }

    const max = getVaultLimit(target);
    if (page > max) {
        return sendMessage(opener, 
            `${target.getName()} only has access to ${max} vaults.`, 
            NamedTextColor.RED
        );
    }

    // Admin opens the target's vault
    openVault(opener, target, page, max);
}));

// ----------------------------------------------------
// EVENT: InventoryCloseEvent (Data Persistence)
// ----------------------------------------------------
/**
 * Uses the ScriptCore destructured array signature to get the Player.
 */
Event.on("inventory.InventoryCloseEvent", ([player], event) => safe(() => {
    
    if (!(player instanceof Player)) return; 

    // Access view via player
    const view = player.getOpenInventory();
    if (!view) return; 

    const plainTitle = PlainTextComponentSerializer.plainText().serialize(view.title());
    
    if (!plainTitle.startsWith(VAULT_TITLE_PREFIX)) return; 

    const page = getPageNumber(plainTitle); 
    
    // Save the contents of the closed inventory
    saveToStorage(player, event.getInventory().getContents(), page);
}));


// ========================================================
// ------------------- onLoad Equivalent ------------------
// ========================================================

Scheduler.runTask(() => {
    log("PlayerVaults JS script loaded successfully with command-based navigation.");
});