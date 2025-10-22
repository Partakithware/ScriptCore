/**
 * ScriptCore Universal Auto-Binder (use(clazz) version) — Fully GraalVM-free
 * Safely resolves Java classes, supports commands, events, scheduler, and item creation.
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
    "java.util.",
    "java.lang."
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
            log(`[AutoBinder] Bound ${clazz} → ${prefix}${clazz}`);
            return type;
        } catch {}
    }

    warn(`[ScriptCore] Failed to bind ${clazz}`);
    return null;
}

// ---------- Common Shortcuts ----------
const Bukkit = use("Bukkit");
const Material = use("Material");
const Player = use("Player");
const ItemStack = use("ItemStack");
const NamespacedKey = use("NamespacedKey");
const PersistentDataType = use("PersistentDataType");

// ---------- Scheduler Wrapper (no Java.extend) ----------
Scheduler.runTask(() => {
    Bukkit.broadcastMessage("Hello from Scheduler.runTask!");
});

// Schedule repeating task
Scheduler.runTaskTimer(() => {
    //Bukkit.broadcastMessage("Hello every 20 ticks!");
}, 20, 20);

// Async (still runs JS on main thread)
Scheduler.runTaskAsync(() => {
    Bukkit.broadcastMessage("Hello async!");
});


// ---------- JS Array → Java List ----------
function javaList(arr) {
    const ArrayList = use("ArrayList");
    const list = new ArrayList();
    for (let i = 0; i < arr.length; i++) list.add(arr[i]);
    return list;
}

// ---------- Create ItemStack ----------
function createItem(material, amount, displayName, loreArray) {
    const mat = typeof material === "string" ? Material.valueOf(material) : material;
    if (!mat) throw new Error("Unknown material: " + material);
    const item = new ItemStack(mat, amount || 1);
    safe(() => {
        const meta = item.getItemMeta();
        if (displayName) meta.setDisplayName(displayName);
        if (loreArray?.length) meta.setLore(javaList(loreArray));
        item.setItemMeta(meta);
    });
    return item;
}

// ---------- Safe Command/Event Stubs ----------
const Command = globalThis.Command ?? {
    register: (name, fn) => warn(`[ScriptCore] Command helper unavailable, ignored: ${name}`)
};
const Event = globalThis.Event ?? {
    on: (evt, fn) => warn(`[ScriptCore] Event helper unavailable, ignored: ${evt}`)
};

// ---------- Example Commands ----------
Command.register("givetool", (sender, args) => safe(() => {
    const target = args?.length ? Bukkit.getPlayer(args[0]) : sender;
    if (!target) return sender.sendMessage("§cPlayer not found!");
    const item = createItem("DIAMOND_PICKAXE", 1, "§bTool of Scripts", ["§7From JS realm"]);
    const key = new NamespacedKey(plugin, "owner");
    const meta = item.getItemMeta();
    meta.getPersistentDataContainer().set(key, PersistentDataType.STRING, target.getName());
    item.setItemMeta(meta);
    target.getInventory().addItem(item);
    target.sendMessage("§aYou received the Tool of Scripts!");
}));

Command.register("openvault", (sender, args) => safe(() => {
    if (!(sender instanceof Player)) return sender.sendMessage("§cRun this command in-game!");
    const inv = Bukkit.createInventory(null, 27, "§dScriptCore Vault");
    for (let i = 0; i < 6; i++)
        inv.setItem(i, createItem("PAPER", 1, "§fNote " + (i + 1), ["§7Dynamic script item"]));
    sender.openInventory(inv);
}));

Command.register("listmethods", (sender, args) => safe(() => {
    if (!args?.length) return sender.sendMessage("Usage: /listmethods <ClassName>");
    
    const cls = use(args[0]);
    if (!cls) return sender.sendMessage("§cClass not found: " + args[0]);

    let clsJava;
    try {
        // Get the actual java.lang.Class from the constructor
        clsJava = cls.class || cls.prototype?.getClass?.() || null;
        if (!clsJava) throw new Error("Cannot access java.lang.Class object");
    } catch (e) {
        return sender.sendMessage("§cFailed to get class object: " + e.message);
    }

    const methods = clsJava.getMethods();
    if (!methods?.length) return sender.sendMessage("§cNo methods found for " + args[0]);

    sender.sendMessage("§6Methods for " + args[0] + ":");
    for (const m of methods) {
        sender.sendMessage(" - §e" + m.getName() + "§7(" + m.getParameterTypes().join(", ") + ")");
    }
}));

// ---------- Heartbeat ----------
let counter = 0;
Scheduler.runTaskTimer(() => safe(() => {
    counter++;
    if (counter % 10 === 0){}
        //Bukkit.broadcastMessage("§6[ScriptCore] heartbeat " + counter);
}), 20, 20);

// ---------- PlayerJoin Event ----------
    Event.on("player.PlayerJoinEvent", (player, event) => {
        player.sendMessage("§aWelcome, " + player.getName() + "!");
        player.getInventory().addItem(createItem("IRON_SWORD", 1, "§cStarter Sword", ["§7Auto-binder working!"]));
    });


// ---------- onLoad ----------
safe(() => log("use(clazz)-based AutoBinder loaded successfully — GraalVM-free."));
