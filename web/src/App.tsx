import { useEffect, useMemo, useState } from 'react';
import { Search, Trophy, TrendingUp, MessageSquare, Trash2, ArrowRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { type MemberAnalytics } from './whatsapp';

import { ArchetypeCard, getArchetypeConfig } from './components/ArchetypeCard';
import { cn } from './lib/utils';

type Member = MemberAnalytics;
const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? '';
const ASSET_BASE = import.meta.env.BASE_URL ?? '/';
const UPLOAD_KEY = 'wa_upload_id_v1';

const memberKey = (member: Member) => `${member.name}::${member.phoneNumber ?? ''}`;
const CREATOR_MATCH = 'Abhyudaya';
const CREATOR_DISPLAY = 'Sovereign of the Void';
const CREATOR_TAG = '@ALikesToCode';
const ARCHETYPE_ORDER = [
  'Ghost',
  'Shadow Watcher',
  'Problem Solver',
  'Curator',
  'Comedian',
  'Asker',
  'Deep Writer',
];
const CREATOR_GITHUB = 'https://github.com/ALikesToCode/';

const toNumber = (value: unknown, fallback = 0) => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const displayName = (member: Member) => {
  if (member.name === CREATOR_MATCH) return `${CREATOR_DISPLAY} ${CREATOR_TAG}`;
  return member.name;
};

const normalizeMember = (member: any): Member => ({
  name: member?.name ?? '',
  phoneNumber: member?.phoneNumber ?? member?.phone_number ?? '',
  stats: {
    messages: toNumber(member?.stats?.messages),
    words: toNumber(member?.stats?.words),
    media: toNumber(member?.stats?.media),
    links: toNumber(member?.stats?.links),
    active_days: toNumber(member?.stats?.active_days),
  },
  signals: member?.signals
    ? {
      answer_like: toNumber(member?.signals?.answer_like),
      reply_helpfulness: toNumber(member?.signals?.reply_helpfulness),
      long_msgs: toNumber(member?.signals?.long_msgs),
      unique_words: toNumber(member?.signals?.unique_words),
      duplicate_count: toNumber(member?.signals?.duplicate_count),
    }
    : undefined,
  analysis: {
    value_score: toNumber(member?.analysis?.value_score),
    role: member?.analysis?.role ?? 'Shadow Watcher',
    vibe: member?.analysis?.vibe ?? '',
  },
  badges: Array.isArray(member?.badges) ? member.badges : [],
  samples: Array.isArray(member?.samples) ? member.samples : [],
});

async function fetchUpload(uploadId: string): Promise<Member[]> {
  const res = await fetch(`${API_BASE}/api/uploads/${uploadId}`);
  if (!res.ok) throw new Error('Failed to load upload.');
  const payload = await res.json();
  return (payload.members ?? []).map(normalizeMember);
}


function App() {
  const [data, setData] = useState<Member[]>([]);
  const [search, setSearch] = useState('');
  const [selectedProfile, setSelectedProfile] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceLabel, setSourceLabel] = useState<string>('');
  const [searchError, setSearchError] = useState<string>('');

  useEffect(() => {
    const cached = localStorage.getItem('wa_members_v1');
    const uploadId = localStorage.getItem(UPLOAD_KEY);

    const loadCache = () => {
      if (!cached) return false;
      try {
        const parsed = JSON.parse(cached) as Member[];
        setData(parsed.map(normalizeMember));
        setSourceLabel(localStorage.getItem('wa_members_source_v1') || 'Local cache');
        setLoading(false);
        return true;
      } catch {
        localStorage.removeItem('wa_members_v1');
        return false;
      }
    };

    if (uploadId) {
      fetchUpload(uploadId)
        .then((members) => {
          setData(members);
          setSourceLabel('Saved upload');
          setLoading(false);
        })
        .catch((err) => {
          console.error('Failed to load upload', err);
          localStorage.removeItem(UPLOAD_KEY);
          if (!loadCache()) {
            fetch('/data/members.json')
              .then((res) => res.json())
              .then((members) => {
                setData((members ?? []).map(normalizeMember));
                setSourceLabel('Demo data');
                setLoading(false);
              })
              .catch(() => {
                setSourceLabel('No data loaded');
                setLoading(false);
              });
          }
        });
      return;
    }

    if (loadCache()) return;

    fetch('/data/members.json')
      .then((res) => res.json())
      .then((members) => {
        setData((members ?? []).map(normalizeMember));
        setSourceLabel('Demo data');
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load data', err);
        setSourceLabel('No data loaded');
        setLoading(false);
      });
  }, []);

  const handleSearch = () => {
    const needle = search.trim();
    const digits = needle.replace(/\D/g, '');
    const found = data.find((m) => {
      const nameMatch = m.name.toLowerCase().includes(needle.toLowerCase());
      if (nameMatch) return true;
      if (!digits) return false;
      const phoneDigits = (m.phoneNumber || '').replace(/\D/g, '');
      const nameDigits = (m.name || '').replace(/\D/g, '');
      return phoneDigits.includes(digits) || nameDigits.includes(digits);
    });
    if (found) {
      setSelectedProfile(found);
      setSearchError('');
    } else {
      setSearchError('No match. Try the saved contact name — numbers are often hidden in exports.');
    }
  };


  const clearLocalData = () => {
    localStorage.removeItem('wa_members_v1');
    localStorage.removeItem('wa_members_source_v1');
    localStorage.removeItem(UPLOAD_KEY);
    window.location.reload();
  };

  const leaderboards = useMemo(() => {
    const byMessages = [...data].sort((a, b) => b.stats.messages - a.stats.messages).slice(0, 5);
    const byValue = [...data].sort((a, b) => b.analysis.value_score - a.analysis.value_score).slice(0, 5);
    const byHelp = [...data]
      .sort((a, b) => (b.signals?.reply_helpfulness ?? 0) - (a.signals?.reply_helpfulness ?? 0))
      .slice(0, 5);

    const byArchetype = data.reduce((acc, curr) => {
      const role = curr.analysis.role || 'Member';
      acc[role] = (acc[role] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Convert to array and sort
    const topArchetypes = ARCHETYPE_ORDER
      .map((role) => ({ role, count: byArchetype[role] || 0 }))
      .sort((a, b) => b.count - a.count);

    const tribeBoards = ARCHETYPE_ORDER
      .map((role) => {
        const members = data
          .filter((m) => (m.analysis.role || 'Member') === role)
          .sort((a, b) => b.analysis.value_score - a.analysis.value_score)
          .slice(0, 5);
        return { role, count: byArchetype[role] || 0, members };
      })
      .sort((a, b) => b.count - a.count);

    return { byMessages, byValue, byHelp, topArchetypes, tribeBoards };
  }, [data]);

  const rankByValue = useMemo(() => {
    const sorted = [...data].sort((a, b) => b.analysis.value_score - a.analysis.value_score);
    const map = new Map<string, number>();
    sorted.forEach((member, index) => {
      map.set(memberKey(member), index + 1);
    });
    return map;
  }, [data]);

  const selectedRank = selectedProfile ? rankByValue.get(memberKey(selectedProfile)) : undefined;

  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#050508] text-white/50 gap-4">
      <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      <p className="font-light tracking-wide text-sm uppercase">Initializing Analytics...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#050508] text-[#ECEAEC] font-sans selection:bg-fuchsia-500/30 overflow-x-hidden">
      {/* Background Gradient Mesh */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-purple-900/10 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-900/10 blur-[120px]" />
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 md:py-12 relative z-10 font-medium overflow-hidden">

        {/* Navigation / Header */}
        <nav className="w-full flex flex-col md:flex-row justify-between items-center mb-12 gap-6">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl border border-white/10 bg-white/5 p-1">
              <img
                src={`${ASSET_BASE}assets/icon.png`}
                alt="Echoes dashboard icon"
                className="h-full w-full rounded-xl object-cover"
              />
            </div>
            <div className="flex flex-col items-center md:items-start text-center md:text-left">
              <h1 className="text-3xl font-display font-medium tracking-tight text-white/90">
                Echoes
              </h1>
              <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">WhatsApp Analytics</span>
            </div>
          </div>

          <div className="flex items-center gap-3 w-auto justify-center">
            {/* Upload Button */}

            {/* Error Display */}

            {/* Reset Button */}
            {sourceLabel !== 'Demo data' && (
              <button onClick={clearLocalData} className="p-2 rounded-full hover:bg-white/5 text-white/40 hover:text-red-400 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </nav>

        {/* Viewing Profile Mode */}
        {selectedProfile ? (
          <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out relative">
            {/* Dynamic Archetype Lighting Mesh */}
            <div className="absolute inset-x-0 top-[-200px] h-[600px] pointer-events-none -z-10 opacity-30">
              <div className={cn(
                "w-full h-full bg-gradient-to-b blur-[120px] transition-all duration-1000",
                getArchetypeConfig(selectedProfile.analysis.role).gradient
              )} />
            </div>

            <button onClick={() => setSelectedProfile(null)} className="group flex items-center gap-2 text-white/40 hover:text-white text-sm mb-8 py-2 transition-colors">
              <ArrowRight className="w-4 h-4 rotate-180 transition-transform group-hover:-translate-x-1" />
              Back to Dashboard
            </button>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

              {/* Visual Archetype Column */}
              <div className="lg:col-span-4 xl:col-span-3 flex flex-col items-center md:items-stretch">
                <div className="w-full max-w-sm md:max-w-none">
                  <ArchetypeCard role={selectedProfile.analysis.role} className="w-full shadow-2xl shadow-purple-900/20" />
                </div>
                <div className="w-full mt-8 p-6 rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-md">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-white/30 mb-4">Identity Signals</h4>
                  <div className="space-y-4">
                    <SignalBar label="Helpfulness" value={selectedProfile.signals?.answer_like || 0} max={10} color="bg-emerald-500" />
                    <SignalBar label="Verbosity" value={selectedProfile.signals?.long_msgs || 0} max={20} color="bg-blue-500" />
                    <SignalBar label="Engagement" value={selectedProfile.signals?.reply_helpfulness || 0} max={15} color="bg-purple-500" />
                  </div>
                </div>
              </div>

              {/* Data & Vibe Column */}
              <div className="lg:col-span-8 xl:col-span-9 space-y-6">

                {/* Hero Text */}
                <div className="p-6 md:p-8 rounded-[2rem] bg-white/[0.03] border border-white/5 backdrop-blur-sm relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-8 md:p-12 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity duration-700">
                    <h1 className="text-7xl md:text-9xl font-display font-black text-white">
                      #{selectedRank ?? '--'}
                    </h1>
                  </div>
                  <h2 className="text-3xl md:text-5xl lg:text-7xl font-display font-medium text-white mb-4 tracking-tight leading-none break-words">
                    {displayName(selectedProfile)}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-6">
                    <span className="px-3 py-1 rounded-full border border-white/10 bg-white/5 text-xs text-purple-300 font-mono flex-shrink-0">
                      Score: {selectedProfile.analysis.value_score}
                    </span>
                    {selectedProfile.name === CREATOR_MATCH && (
                      <span className="px-3 py-1 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 text-xs text-fuchsia-200 font-mono flex-shrink-0">
                        Creator
                      </span>
                    )}
                    {selectedProfile.badges.map(b => (
                      <span key={b} className="text-xs text-white/50 flex items-center gap-1 flex-shrink-0">
                        • {b}
                      </span>
                    ))}
                  </div>
                  <p className="text-xl md:text-2xl text-white/70 font-display italic font-light leading-relaxed max-w-2xl">
                    "{selectedProfile.analysis.vibe}"
                  </p>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                  <StatCard label="Messages" value={selectedProfile.stats.messages} />
                  <StatCard label="Words" value={selectedProfile.stats.words} />
                  <StatCard label="Media" value={selectedProfile.stats.media} />
                  <StatCard label="Links" value={selectedProfile.stats.links} />
                </div>

                {/* Chart Area */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="md:col-span-2 p-6 rounded-3xl bg-white/[0.02] border border-white/5 min-h-[300px] flex flex-col justify-center">
                    <h3 className="text-sm font-medium text-white/40 mb-6 uppercase tracking-wider">Contribution Mix</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={[
                        { name: 'Words', value: selectedProfile.stats.words },
                        { name: 'Media', value: selectedProfile.stats.media * 20 },
                        { name: 'Links', value: selectedProfile.stats.links * 10 }
                      ]}>
                        <XAxis dataKey="name" stroke="#3f3f46" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis hide />
                        <Tooltip
                          cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                          contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e4e4e7', borderRadius: '12px', color: '#000000' }}
                        />
                        <Bar dataKey="value" radius={[6, 6, 6, 6]}>
                          {['#8b5cf6', '#ec4899', '#06b6d4'].map((color, i) => (
                            <Cell key={i} fill={color} fillOpacity={0.8} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="p-6 rounded-3xl bg-indigo-900/10 border border-indigo-500/10 flex flex-col items-center justify-center text-center">
                    <span className="text-6xl font-display font-semibold text-indigo-400 mb-2">
                      {Math.round(selectedProfile.stats.words / (selectedProfile.stats.messages || 1))}
                    </span>
                    <span className="text-xs uppercase tracking-widest text-indigo-300/50">Avg Words / Msg</span>
                  </div>
                </div>

              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-16 animate-in fade-in-50 duration-700">
            {/* Search Hero */}
            <div className="text-center space-y-8 py-4 md:py-10 px-2">
              <h2 className="text-4xl md:text-5xl lg:text-7xl font-display font-medium text-transparent bg-clip-text bg-gradient-to-b from-white via-white to-white/40 tracking-tight pb-2 leading-tight">
                Who is the main <br className="hidden md:block" /> character?
              </h2>

              <div className="max-w-xl mx-auto relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl opacity-20 group-hover:opacity-40 blur transition duration-500" />
                <div className="relative flex items-center bg-[#0A0A0E] rounded-2xl border border-white/10 p-1.5 md:p-2 shadow-2xl">
                  <Search className="w-5 h-5 text-white/30 ml-3 hidden md:block" />
                  <input
                    type="text"
                    placeholder="Find a member..."
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      if (searchError) setSearchError('');
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    className="flex-1 bg-transparent border-none text-white placeholder:text-white/20 focus:outline-none px-3 md:px-4 py-2 md:py-3 text-base md:text-lg font-light min-w-0"
                  />
                  <button onClick={handleSearch} className="px-4 md:px-6 py-2 bg-white text-black rounded-xl font-medium hover:bg-white/90 transition-colors text-sm md:text-base shrink-0">
                    Analyze
                  </button>
                </div>
                {searchError && (
                  <p className="text-sm text-amber-300 mt-3">{searchError}</p>
                )}
              </div>
            </div>

            {/* Leaderboards Bento */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="md:col-span-1">
                <ArchetypeRankList title="Tribe Vibes" icon={<Trophy className="w-4 h-4" />} items={leaderboards.topArchetypes} delay={0} />
              </div>
              <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
                <RankList title="The Yappers" icon={<MessageSquare className="w-4 h-4" />} members={leaderboards.byMessages} metric="messages" onPick={setSelectedProfile} delay={100} />
                <RankList title="High Value" icon={<Trophy className="w-4 h-4" />} members={leaderboards.byValue} metric="value_score" onPick={setSelectedProfile} delay={200} accent />
                <RankList title="The Helpers" icon={<TrendingUp className="w-4 h-4" />} members={leaderboards.byHelp} metric="help" onPick={setSelectedProfile} delay={300} />
              </div>
            </div>

            <div className="space-y-6">
              <div className="text-center space-y-2 px-4">
                <h3 className="text-2xl font-display font-medium text-white">Tribe Leaderboards</h3>
                <p className="text-white/40 text-sm">Top members per archetype.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {leaderboards.tribeBoards.map((tribe: any, idx: number) => (
                  <TribeBoard key={tribe.role} role={tribe.role} count={tribe.count} members={tribe.members} delay={idx * 80} onPick={setSelectedProfile} />
                ))}
              </div>
            </div>

            {/* All Archetypes Showcase */}
            <div className="space-y-8 pt-12 border-t border-white/5">
              <div className="text-center space-y-2 px-4">
                <h3 className="text-2xl font-display font-medium text-white">The Archetypes</h3>
                <p className="text-white/40 text-sm">Collect them all. Or just be a Ghost.</p>
              </div>

              <div className="flex gap-6 md:gap-8 overflow-x-auto pb-8 snap-x snap-mandatory px-4 md:px-0 -mx-4 md:mx-0 scrollbar-hide">
                {ARCHETYPE_ORDER.map((role) => (
                  <div key={role} className="flex-shrink-0 w-[200px] md:w-[240px] snap-center first:pl-2">
                    <ArchetypeCard role={role} className="shadow-2xl" />
                  </div>
                ))}
              </div>
            </div>

            <footer className="text-center text-white/30 text-sm font-light mt-20 flex flex-col items-center gap-3">
              <a
                href={CREATOR_GITHUB}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-colors text-white/70"
              >
                Follow on GitHub
              </a>
              <span>
                Made with love by <a className="text-white/70 hover:text-white" href={CREATOR_GITHUB} target="_blank" rel="noreferrer">@ALikesToCode</a>
              </span>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}

// Components
const StatCard = ({ label, value }: { label: string, value: number }) => (
  <div className="p-4 md:p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors">
    <div className="text-2xl md:text-3xl font-display font-medium text-white mb-1">{value?.toLocaleString()}</div>
    <div className="text-[10px] uppercase tracking-widest text-white/30">{label}</div>
  </div>
);

const RankList = ({ title, icon, members, metric, onPick, delay, accent }: any) => (
  <div
    className={cn(
      "p-4 md:p-6 rounded-3xl border flex flex-col h-full animate-in slide-in-from-bottom-4 fill-mode-backwards",
      accent ? "bg-white/[0.03] border-white/10" : "bg-white/[0.01] border-white/5"
    )}
    style={{ animationDelay: `${delay}ms` }}
  >
    <div className="flex items-center gap-2 mb-6 text-white/90">
      <div className={cn("p-2 rounded-lg", accent ? "bg-purple-500/20 text-purple-400" : "bg-white/5 text-white/60")}>
        {icon}
      </div>
      <span className="font-display font-medium text-lg tracking-wide">{title}</span>
    </div>

    <div className="flex-1 space-y-2">
      {members.map((m: any, i: number) => (
        <button
          key={i}
          onClick={() => onPick(m)}
          className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors group text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-mono text-xs text-white/30 w-4 flex-shrink-0">{i + 1}</span>
            <span className="text-white/80 group-hover:text-white transition-colors text-xs md:text-sm font-medium truncate">{displayName(m)}</span>
          </div>
          <span className="font-mono text-xs text-white/40 group-hover:text-white/60 flex-shrink-0 pl-2">
            {metric === 'value_score'
              ? toNumber(m.analysis.value_score).toFixed(1)
              : metric === 'messages'
                ? toNumber(m.stats.messages).toLocaleString()
                : metric === 'help'
                  ? toNumber(m.signals?.reply_helpfulness).toLocaleString()
                  : toNumber(m.stats.media).toLocaleString()}
          </span>
        </button>
      ))}
    </div>
  </div>
);

const TribeBoard = ({ role, count, members, delay, onPick }: any) => (
  <div
    className="p-4 md:p-5 rounded-3xl border bg-white/[0.02] border-white/10 flex flex-col animate-in slide-in-from-bottom-4 fill-mode-backwards"
    style={{ animationDelay: `${delay}ms` }}
  >
    <div className="flex items-start justify-between gap-2 mb-4">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-white/40">Tribe</div>
        <div className="text-lg font-display font-medium text-white">{role}</div>
      </div>
      <div className="text-xs font-mono text-white/40">{toNumber(count).toLocaleString()}</div>
    </div>
    <div className="space-y-2">
      {members.map((m: Member, i: number) => (
        <button
          key={`${role}-${i}`}
          onClick={() => onPick(m)}
          className="w-full flex items-center justify-between rounded-xl px-3 py-2 hover:bg-white/5 transition-colors text-left group"
        >
          <span className="text-xs md:text-sm text-white/80 truncate pr-2 group-hover:text-white transition-colors">{displayName(m)}</span>
          <span className="text-xs font-mono text-white/40 flex-shrink-0">{toNumber(m.analysis.value_score).toFixed(1)}</span>
        </button>
      ))}
      {members.length === 0 && (
        <div className="text-xs text-white/30 italic">No members yet.</div>
      )}
    </div>
  </div>
);

const ArchetypeRankList = ({ title, icon, items, delay }: any) => {
  const maxCount = Math.max(1, ...items.map((item: any) => toNumber(item.count)));
  return (
    <div
      className="p-4 md:p-6 rounded-3xl border bg-white/[0.01] border-white/5 flex flex-col h-full animate-in slide-in-from-bottom-4 fill-mode-backwards"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-2 mb-6 text-white/90">
        <div className="p-2 rounded-lg bg-white/5 text-white/60">
          {icon}
        </div>
        <span className="font-display font-medium text-lg tracking-wide">{title}</span>
      </div>

      <div className="flex-1 space-y-3">
        {items.map((item: any, i: number) => (
          <div key={i} className="flex items-center justify-between p-2">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-white/30 w-4">{i + 1}</span>
              <span className="text-white/80 text-sm font-medium">{item.role}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-16 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-purple-500/50" style={{ width: `${Math.round((toNumber(item.count) / maxCount) * 100)}%` }} />
              </div>
              <span className="font-mono text-xs text-white/40 w-8 text-right">{toNumber(item.count).toLocaleString()}</span>
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="text-xs text-white/30 italic">No archetypes found</div>}
      </div>
    </div>
  );
};

const SignalBar = ({ label, value, max, color }: any) => {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-white/40">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-1000", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

export default App;
