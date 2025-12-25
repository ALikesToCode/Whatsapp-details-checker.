import { useMemo } from 'react';
import { cn } from '../lib/utils'; // Assuming utils exists or I will create it/inline it

// Map roles to their respective image assets and gradient themes
const ARCHETYPE_CONFIG: Record<string, { image: string, gradient: string, glow: string }> = {
    "Ghost": {
        image: "/assets/avatars/Ghost.png",
        gradient: "from-indigo-500 via-purple-500 to-slate-800",
        glow: "shadow-indigo-500/50"
    },
    "Problem Solver": {
        image: "/assets/avatars/ProblemSolver.png",
        gradient: "from-orange-400 via-amber-500 to-yellow-600",
        glow: "shadow-amber-500/50"
    },
    "Curator": {
        image: "/assets/avatars/Curator.png",
        gradient: "from-emerald-400 via-teal-500 to-cyan-600",
        glow: "shadow-teal-500/50"
    },
    "Comedian": {
        image: "/assets/avatars/Comedian.png",
        gradient: "from-pink-500 via-rose-500 to-red-600",
        glow: "shadow-pink-500/50"
    },
    "Asker": {
        image: "/assets/avatars/Asker.png",
        gradient: "from-violet-500 via-purple-500 to-fuchsia-600",
        glow: "shadow-purple-500/50"
    },
    "Deep Writer": {
        image: "/assets/avatars/DeepWriter.png",
        gradient: "from-blue-600 via-indigo-600 to-violet-700",
        glow: "shadow-blue-500/50"
    },
    // Fallback
    "Member": {
        image: "/assets/avatars/Ghost.png", // Default to Ghost for now or generic
        gradient: "from-zinc-700 via-zinc-800 to-zinc-900",
        glow: "shadow-zinc-500/50"
    }
};

interface ArchetypeCardProps {
    role: string;
    className?: string;
}

export function ArchetypeCard({ role, className }: ArchetypeCardProps) {
    const config = useMemo(() => {
        // Fuzzy match or exact match? The python script output exact strings.
        // If not found, check if it contains keywords or default
        if (ARCHETYPE_CONFIG[role]) return ARCHETYPE_CONFIG[role];

        // Fallback logic
        if (role.includes("Writer")) return ARCHETYPE_CONFIG["Deep Writer"];
        if (role.includes("Problem") || role.includes("Fixer")) return ARCHETYPE_CONFIG["Problem Solver"];
        return ARCHETYPE_CONFIG["Member"];
    }, [role]);

    return (
        <div className={cn("relative group perspective-1000", className)}>
            <div className={cn(
                "relative w-full aspect-[3/4] rounded-[2rem] overflow-hidden p-8 flex flex-col justify-between transition-all duration-700 ease-out transform hover:scale-[1.02] hover:shadow-3xl isolate",
                "bg-gradient-to-b shadow-2xl",
                config.gradient,
                config.glow
            )}>
                {/* Subtle Noise Texture */}
                <div className="absolute inset-0 opacity-30 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] mix-blend-overlay pointer-events-none"></div>

                {/* Top Meta */}
                <div className="relative z-10 flex justify-between items-start">
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-[0.2em] text-white/60 font-medium">Archetype</span>
                        <span className="text-white/90 font-display text-lg leading-none mt-1">2025</span>
                    </div>
                    <div className="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center">
                        <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                    </div>
                </div>

                {/* 3D Avatar */}
                <div className="absolute inset-0 flex items-center justify-center z-0 top-4">
                    <img
                        src={config.image}
                        alt={role}
                        className="w-[85%] aspect-square object-cover rounded-[2rem] shadow-2xl transition-transform duration-700 ease-out group-hover:-translate-y-4 group-hover:scale-105 will-change-transform"
                    />
                </div>

                {/* Bottom Label */}
                <div className="relative z-10 mt-auto">
                    <div className="inline-block px-4 py-2 rounded-xl bg-white/10 backdrop-blur-md border border-white/10 shadow-lg">
                        <h3 className="text-xl md:text-2xl font-display font-bold text-white tracking-tight">{role}</h3>
                    </div>
                </div>
            </div>
        </div>
    );
}
