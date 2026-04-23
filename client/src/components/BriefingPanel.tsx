/**
 * BriefingPanel — Presidential Daily Brief generated from web OSINT research
 * via Gemini Google Search grounding. Sections follow `Presidental Daily Brief`.
 */
import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';

interface Citation {
  uri: string;
  title: string;
}

interface BriefVisualMap {
  label: string;
  lat: number;
  lon: number;
  embedUrl: string;
}

interface BriefVisualImage {
  uri: string;
  title: string;
  imageUrl: string;
}

interface BriefSection {
  id: string;
  classification: string;
  title: string;
  summary: string;
  keyPoints: string[];
  indicators: string[];
  strategicImplication: string;
  threatLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  regions: string[];
  timestamp: string;
  eventCount: number;
  sources: string[];
  /** URLs returned by Gemini's Google Search grounding tool. */
  citations: Citation[];
  /** Search queries Gemini ran to produce this assessment (for transparency). */
  searchQueries: string[];
  /** Which Gemini model actually produced the output (for diagnostics). */
  modelUsed?: string;
  visuals?: {
    map?: BriefVisualMap;
    images?: BriefVisualImage[];
  };
}

const THREAT_COLORS: Record<BriefSection['threatLevel'], string> = {
  CRITICAL: '#f85149',
  HIGH: '#f0883e',
  MEDIUM: '#d29922',
  LOW: '#3fb950',
};

const THREAT_BG: Record<BriefSection['threatLevel'], string> = {
  CRITICAL: '#f8514922',
  HIGH: '#f0883e22',
  MEDIUM: '#d2992222',
  LOW: '#3fb95022',
};

type VideoVoicePreset =
  | 'obama'
  | 'reagan'
  | 'lincoln'
  | 'trump'
  | 'arnold'
  | 'stallone'
  | 'freeman'
  | 'oprah'
  | 'samuel';

type VideoTone = 'official' | 'neutral' | 'funny';

const VIDEO_VOICES: Array<{ id: VideoVoicePreset; label: string }> = [
  { id: 'obama', label: 'President Obama' },
  { id: 'reagan', label: 'President Reagan' },
  { id: 'lincoln', label: 'President Lincoln' },
  { id: 'trump', label: 'Donald Trump' },
  { id: 'arnold', label: 'Arnold Schwarzenegger' },
  { id: 'stallone', label: 'Sylvester Stallone' },
  { id: 'freeman', label: 'Morgan Freeman' },
  { id: 'oprah', label: 'Oprah Winfrey' },
  { id: 'samuel', label: 'Samuel L. Jackson' },
];

const VIDEO_TONES: Array<{ id: VideoTone; label: string }> = [
  { id: 'official', label: 'Serious official' },
  { id: 'neutral', label: 'Neutral analyst' },
  { id: 'funny', label: 'Funny' },
];
const MAX_VIDEO_SLIDE_SECONDS = 30;

/** Presidential Daily Brief section structure from `Presidental Daily Brief`. */
const THEMES: Array<{
  id: string;
  title: string;
  topic: string;
  classification: string;
  briefingSection: string;
}> = [
  {
    id: 'executive',
    title: 'Executive Summary (Global BLUF)',
    topic: 'top 3-5 most critical global security developments in the last 24 hours',
    classification: 'UNCLASSIFIED',
    briefingSection: 'Slide 1: Executive Summary (Global BLUF)',
  },
  {
    id: 'eucom',
    title: 'EUCOM (Ukraine & Russia)',
    topic:
      'EUCOM theater developments including Ukraine-Russia battlefield dynamics, Black Sea activity, and energy infrastructure attacks',
    classification: 'UNCLASSIFIED',
    briefingSection: 'Slide 2: EUCOM (Focus: Ukraine & Russia)',
  },
  {
    id: 'centcom',
    title: 'CENTCOM (Iran & Middle East)',
    topic:
      'CENTCOM developments: Strait of Hormuz maritime security, Iranian naval movements, proxy stability, Israel-Lebanon ceasefire and UNIFIL status',
    classification: 'UNCLASSIFIED',
    briefingSection: 'Slide 3: CENTCOM (Focus: Iran & Middle East)',
  },
  {
    id: 'indopacom',
    title: 'INDOPACOM (Asia-Pacific)',
    topic:
      'INDOPACOM developments: major regional disasters and security shifts in the South China Sea and Korean Peninsula',
    classification: 'UNCLASSIFIED',
    briefingSection: 'Slide 4: INDOPACOM (Focus: Asia-Pacific)',
  },
  {
    id: 'africom-southcom',
    title: 'AFRICOM & SOUTHCOM',
    topic:
      'AFRICOM and SOUTHCOM developments including Flintlock activity and instability in West Africa and South America',
    classification: 'UNCLASSIFIED',
    briefingSection: 'Slide 5: AFRICOM & SOUTHCOM',
  },
  {
    id: 'domestic-financial',
    title: 'Domestic & Financial Intelligence',
    topic:
      'top U.S. domestic developments plus financial intelligence: S&P 500, energy costs, and Federal Reserve Beige Book implications',
    classification: 'UNCLASSIFIED',
    briefingSection: 'Slide 6: Domestic & Financial Intelligence',
  },
  {
    id: 'washington',
    title: 'Washington & Legislative Affairs',
    topic:
      'status of key U.S. legislation and congressional activity relevant to national security including FISA Section 702 and appropriations',
    classification: 'UNCLASSIFIED',
    briefingSection: 'Slide 7: Washington & Legislative Affairs',
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buildNarrationText(
  section: BriefSection,
  idx: number,
  total: number,
  tone: VideoTone,
  allowProfanity: boolean,
): string {
  const key = section.keyPoints.slice(0, 2).join(' ');
  const base = `Slide ${idx + 1} of ${total}. ${section.title}. ${section.summary} ${key}`;
  if (tone === 'official') {
    return `${base} Maintain focus on indicators in ${section.regions.slice(0, 2).join(' and ')}.`;
  }
  if (tone === 'funny') {
    const cuss = allowProfanity ? ' The situation is messy as hell, so keep your eyes open.' : '';
    return `${base} Short version: this is serious, but we can still keep our sense of humor.${cuss}`;
  }
  return `${base} Watch for escalation indicators over the next 48 hours.`;
}

function drawVideoSlide(
  ctx: CanvasRenderingContext2D,
  section: BriefSection,
  index: number,
  total: number,
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#060b16';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#3fb950';
  ctx.fillRect(0, 0, W, 10);
  ctx.fillStyle = '#f85149';
  ctx.fillRect(0, 14, W, 40);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px Inter, system-ui, sans-serif';
  ctx.fillText('PRESIDENTIAL DAILY BRIEF — VIDEO', 36, 41);

  ctx.fillStyle = '#3fb950';
  ctx.font = 'bold 36px Inter, system-ui, sans-serif';
  ctx.fillText(section.title.toUpperCase(), 40, 122);

  ctx.fillStyle = '#8b949e';
  ctx.font = '18px Inter, system-ui, sans-serif';
  ctx.fillText(`Slide ${index + 1}/${total} · ${section.eventCount} events`, 42, 154);
  ctx.fillText(section.regions.slice(0, 4).join(' · '), 42, 182);

  ctx.fillStyle = '#111827';
  ctx.fillRect(36, 212, W - 72, 420);
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 2;
  ctx.strokeRect(36, 212, W - 72, 420);

  ctx.fillStyle = '#e6edf3';
  ctx.font = 'bold 24px Inter, system-ui, sans-serif';
  ctx.fillText('Executive Summary', 58, 256);

  ctx.font = '20px Inter, system-ui, sans-serif';
  const wrapped = section.summary.match(/.{1,95}(\s|$)/g) ?? [section.summary];
  wrapped.slice(0, 8).forEach((line, i) => {
    ctx.fillText(line.trim(), 58, 296 + i * 34);
  });

  ctx.fillStyle = '#58a6ff';
  ctx.font = 'bold 20px Inter, system-ui, sans-serif';
  ctx.fillText('Top Indicators:', 58, 540);
  ctx.fillStyle = '#c9d1d9';
  ctx.font = '18px Inter, system-ui, sans-serif';
  section.indicators.slice(0, 2).forEach((line, i) => {
    ctx.fillText(`• ${line}`, 58, 574 + i * 30);
  });
}

type SectionState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; section: BriefSection }
  | { kind: 'error'; reason: string; hint?: string };

export default function BriefingPanel() {
  const { showBriefing, setShowBriefing } = useStore();
  const [briefDate] = useState(() => {
    const now = new Date();
    return now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  });
  const [sectionStates, setSectionStates] = useState<Record<string, SectionState>>({});
  const [activeSection, setActiveSection] = useState<string>(THEMES[0].id);
  const [isExporting, setIsExporting] = useState(false);
  const [videoVoice, setVideoVoice] = useState<VideoVoicePreset>('obama');
  const [videoTone, setVideoTone] = useState<VideoTone>('official');
  const [allowCursing, setAllowCursing] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [videoProgressPct, setVideoProgressPct] = useState(0);
  const [videoStatus, setVideoStatus] = useState('');
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [generatedVideoFilename, setGeneratedVideoFilename] = useState<string>('');
  const [isGeneratingBrief, setIsGeneratingBrief] = useState(false);
  const [briefStatus, setBriefStatus] = useState('Idle');
  const [analysisProgressPct, setAnalysisProgressPct] = useState(0);
  const generatedForRef = useRef(false);
  const activeControllersRef = useRef<AbortController[]>([]);
  const progressTimersRef = useRef<number[]>([]);
  const slideCaptureRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      activeControllersRef.current.forEach((c) => c.abort());
      progressTimersRef.current.forEach((t) => window.clearInterval(t));
      activeControllersRef.current = [];
      progressTimersRef.current = [];
      if (generatedVideoUrl) URL.revokeObjectURL(generatedVideoUrl);
    };
  }, [generatedVideoUrl]);

  if (!showBriefing) return null;

  const readySections = THEMES.map((t) => sectionStates[t.id]).filter(
    (s): s is Extract<SectionState, { kind: 'ready' }> => s?.kind === 'ready',
  );

  const currentState = sectionStates[activeSection];
  const currentTheme = THEMES.find((t) => t.id === activeSection)!;
  const loadingCount = THEMES.filter((t) => sectionStates[t.id]?.kind === 'loading').length;
  const readyCount = THEMES.filter((t) => sectionStates[t.id]?.kind === 'ready').length;
  const errorCount = THEMES.filter((t) => sectionStates[t.id]?.kind === 'error').length;
  const completedCount = readyCount + errorCount;
  const analysisProgress = Math.max(
    THEMES.length ? Math.round((completedCount / THEMES.length) * 100) : 100,
    analysisProgressPct,
  );
  const isAnalyzing = loadingCount > 0;

  const generateBrief = async () => {
    if (isGeneratingBrief) return;
    setIsGeneratingBrief(true);
    setBriefStatus('Preparing brief: initializing sections…');
    generatedForRef.current = true;
    const init: Record<string, SectionState> = {};
    for (const theme of THEMES) init[theme.id] = { kind: 'loading' };
    setSectionStates(init);
    setAnalysisProgressPct(0);
    setActiveSection(THEMES[0].id);
    activeControllersRef.current.forEach((c) => c.abort());
    progressTimersRef.current.forEach((t) => window.clearInterval(t));
    activeControllersRef.current = [];
    progressTimersRef.current = [];

    for (let i = 0; i < THEMES.length; i++) {
      const theme = THEMES[i];
      const controller = new AbortController();
      activeControllersRef.current.push(controller);
      setBriefStatus(`Preparing brief: researching ${theme.title} (${i + 1}/${THEMES.length})…`);
      const completedBase = Math.round((i / THEMES.length) * 100);
      setAnalysisProgressPct((prev) => Math.max(prev, completedBase));
      let simulated = completedBase;
      const simulatedCap = Math.min(98, completedBase + Math.ceil(75 / THEMES.length));
      const timer = window.setInterval(() => {
        simulated = Math.min(simulatedCap, simulated + 1);
        setAnalysisProgressPct((prev) => (simulated > prev ? simulated : prev));
      }, 280);
      progressTimersRef.current.push(timer);
      try {
        const res = await fetch('/api/briefing/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            topic: theme.topic,
            briefingSection: theme.briefingSection,
            useSearch: true,
          }),
        });
        if (!res.ok) {
          const info = await res.json().catch(() => null as unknown);
          const reason =
            info && typeof info === 'object' && 'reason' in info &&
            typeof (info as { reason?: unknown }).reason === 'string'
              ? (info as { reason: string }).reason
              : `Gemini request failed (${res.status})`;
          const hint =
            info && typeof info === 'object' && 'hint' in info &&
            typeof (info as { hint?: unknown }).hint === 'string'
              ? (info as { hint: string }).hint
              : undefined;
          setSectionStates((prev) => ({
            ...prev,
            [theme.id]: { kind: 'error', reason, hint },
          }));
          window.clearInterval(timer);
          setAnalysisProgressPct(Math.round(((i + 1) / THEMES.length) * 100));
          continue;
        }
        const data = (await res.json()) as {
          summary?: string;
          keyPoints?: string[];
          indicators?: string[];
          strategicImplication?: string;
          threatLevel?: BriefSection['threatLevel'];
          regions?: string[];
          citations?: Citation[];
          searchQueries?: string[];
          modelUsed?: string;
          visuals?: {
            map?: BriefVisualMap;
            images?: BriefVisualImage[];
          };
        };
        const sources = Array.from(
          new Set((data.citations ?? []).map((c) => c.title).filter(Boolean)),
        ).slice(0, 6);
        const section: BriefSection = {
          id: theme.id,
          classification: theme.classification,
          title: theme.title,
          summary: data.summary?.trim() || 'No assessment returned.',
          keyPoints: Array.isArray(data.keyPoints) ? data.keyPoints.slice(0, 8) : [],
          indicators: Array.isArray(data.indicators) ? data.indicators.slice(0, 6) : [],
          strategicImplication:
            typeof data.strategicImplication === 'string' && data.strategicImplication.trim()
              ? data.strategicImplication.trim()
              : 'Assess second-order effects on U.S. interests after validating additional sources.',
          threatLevel:
            data.threatLevel && ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(data.threatLevel)
              ? data.threatLevel
              : 'MEDIUM',
          regions: Array.isArray(data.regions) && data.regions.length > 0 ? data.regions : ['Global'],
          timestamp: new Date().toISOString(),
          eventCount: Array.isArray(data.citations) ? data.citations.length : 0,
          sources,
          citations: Array.isArray(data.citations) ? data.citations.slice(0, 8) : [],
          searchQueries: Array.isArray(data.searchQueries) ? data.searchQueries.slice(0, 6) : [],
          modelUsed: data.modelUsed,
          visuals: data.visuals,
        };
        setSectionStates((prev) => ({ ...prev, [theme.id]: { kind: 'ready', section } }));
        window.clearInterval(timer);
        setAnalysisProgressPct(Math.round(((i + 1) / THEMES.length) * 100));
      } catch (err) {
        if ((err as Error).name === 'AbortError') break;
        window.clearInterval(timer);
        setSectionStates((prev) => ({
          ...prev,
          [theme.id]: {
            kind: 'error',
            reason: (err as Error).message || 'Network error',
          },
        }));
        setAnalysisProgressPct(Math.round(((i + 1) / THEMES.length) * 100));
      }
    }
    setAnalysisProgressPct(100);
    setBriefStatus('Preparing brief: complete.');
    setIsGeneratingBrief(false);
  };

  const exportPDF = async () => {
    if (readySections.length === 0 || !slideCaptureRef.current) return;
    setIsExporting(true);
    const previousSection = activeSection;
    try {
      const { jsPDF } = await import('jspdf');
      const html2canvas = (await import('html2canvas')).default;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 6;

      for (let i = 0; i < readySections.length; i++) {
        const sectionId = readySections[i].section.id;
        setActiveSection(sectionId);
        await new Promise((resolve) => window.setTimeout(resolve, 140));

        const node = slideCaptureRef.current;
        if (!node) continue;
        node.scrollTo({ top: 0 });
        await new Promise((resolve) => window.setTimeout(resolve, 40));

        const canvas = await html2canvas(node, {
          backgroundColor: '#0d1117',
          scale: 2,
          useCORS: true,
          logging: false,
          windowWidth: node.scrollWidth,
          windowHeight: node.scrollHeight,
        });

        const imgData = canvas.toDataURL('image/png');
        const drawableW = pageW - margin * 2;
        const drawableH = pageH - margin * 2;
        const ratio = Math.min(drawableW / canvas.width, drawableH / canvas.height);
        const drawW = canvas.width * ratio;
        const drawH = canvas.height * ratio;
        const x = (pageW - drawW) / 2;
        const y = (pageH - drawH) / 2;

        if (i > 0) doc.addPage();
        doc.addImage(imgData, 'PNG', x, y, drawW, drawH);
      }

      doc.save(`PDB_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error('PDF export failed:', err);
    } finally {
      setActiveSection(previousSection);
      setIsExporting(false);
    }
  };

  const createNarratedVideo = async () => {
    if (readySections.length === 0 || isAnalyzing) return;
    if (generatedVideoUrl) {
      URL.revokeObjectURL(generatedVideoUrl);
      setGeneratedVideoUrl(null);
      setGeneratedVideoFilename('');
    }
    setIsGeneratingVideo(true);
    setVideoProgressPct(0);
    setVideoStatus('Preparing slides…');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');

      const audioContext = new AudioContext();
      const audioDestination = audioContext.createMediaStreamDestination();
      await audioContext.resume();

      const videoStream = canvas.captureStream(30);
      const mixedStream = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks(),
      ]);
      const mimeType =
        [
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm',
        ].find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';

      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(mixedStream, {
        mimeType,
        videoBitsPerSecond: 4_000_000,
      });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.start();

      for (let i = 0; i < readySections.length; i++) {
        const section = readySections[i].section;
        setVideoStatus(`Generating narration ${i + 1}/${readySections.length}: ${section.title}`);
        drawVideoSlide(ctx, section, i, readySections.length);
        await sleep(350);

        const narrationText = buildNarrationText(
          section,
          i,
          readySections.length,
          videoTone,
          allowCursing,
        );
        const ttsRes = await fetch('/api/briefing/video-tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: narrationText,
            voicePreset: videoVoice,
            tone: videoTone,
          }),
        });
        if (!ttsRes.ok) {
          const info = await ttsRes.json().catch(() => null as unknown);
          const reason =
            info && typeof info === 'object' && 'reason' in info
              ? String((info as { reason?: unknown }).reason ?? 'TTS failed')
              : `TTS failed (${ttsRes.status})`;
          throw new Error(reason);
        }

        const arr = await ttsRes.arrayBuffer();
        const audioBuf = await audioContext.decodeAudioData(arr.slice(0));
        const src = audioContext.createBufferSource();
        src.buffer = audioBuf;
        src.connect(audioDestination);
        src.start();
        // Hard cap per-slide narration length.
        const maxSlideMs = MAX_VIDEO_SLIDE_SECONDS * 1000;
        const effectiveMs = Math.min(maxSlideMs, Math.round(audioBuf.duration * 1000));
        if (audioBuf.duration * 1000 > maxSlideMs) {
          src.stop(audioContext.currentTime + MAX_VIDEO_SLIDE_SECONDS);
        }
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            resolve();
          };
          const timeout = window.setTimeout(() => finish(), effectiveMs + 50);
          src.onended = () => {
            finish();
          };
        });
        setVideoProgressPct(Math.round(((i + 1) / readySections.length) * 100));
        await sleep(300);
      }

      setVideoStatus('Finalizing video…');
      await sleep(200);
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
      mixedStream.getTracks().forEach((t) => t.stop());
      await audioContext.close();

      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const filename = `PDB_Video_${new Date().toISOString().slice(0, 10)}.webm`;
      setGeneratedVideoUrl(url);
      setGeneratedVideoFilename(filename);
      setVideoStatus('Video ready. Click Download Video.');
      setVideoProgressPct(100);
    } catch (err) {
      console.error('Video generation failed:', err);
      setVideoStatus(`Video generation failed: ${(err as Error).message || 'unknown error'}`);
    } finally {
      setTimeout(() => {
        setIsGeneratingVideo(false);
      }, 300);
    }
  };

  const downloadGeneratedVideo = () => {
    if (!generatedVideoUrl) return;
    const a = document.createElement('a');
    a.href = generatedVideoUrl;
    a.download = generatedVideoFilename || `PDB_Video_${new Date().toISOString().slice(0, 10)}.webm`;
    a.click();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setShowBriefing(false);
      }}
    >
      <div
        style={{
          width: '90vw',
          maxWidth: 1100,
          height: '85vh',
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
        }}
      >
        {/* Header */}
        <div
          style={{
            background: 'linear-gradient(135deg, #0c1a3d 0%, #0d1117 100%)',
            borderBottom: '2px solid #3fb950',
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: '1 1 420px', minWidth: 300 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                border: '2px solid #3fb950',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
              }}
            >
              🦅
            </div>
            <div>
              <div
                style={{
                  color: '#3fb950',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 2,
                  textTransform: 'uppercase',
                }}
              >
                Unclassified
              </div>
              <div style={{ color: '#e6edf3', fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>
                Presidential Daily Brief
              </div>
              <div style={{ color: '#8b949e', fontSize: 12 }}>
                {briefDate} · web OSINT briefing mode
              </div>
              <div style={{ marginTop: 8, width: 360, maxWidth: '48vw' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 10,
                    color: '#8b949e',
                    marginBottom: 4,
                  }}
                >
                  <span>Analysis progress</span>
                  <span>
                    {generatedForRef.current ? `${completedCount}/${THEMES.length}` : '0/7'} · {analysisProgress}%
                  </span>
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 999,
                    background: '#21262d',
                    overflow: 'hidden',
                    border: '1px solid #30363d',
                  }}
                >
                  <div
                    style={{
                      width: `${analysisProgress}%`,
                      height: '100%',
                      background: isAnalyzing ? 'linear-gradient(90deg, #3fb950, #1f6feb)' : '#3fb950',
                      transition: 'width 240ms ease',
                    }}
                  />
                </div>
                {isGeneratingBrief && (
                  <div style={{ marginTop: 6, color: '#8b949e', fontSize: 11 }}>
                    {briefStatus}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
              flex: '1 1 520px',
              minWidth: 320,
            }}
          >
            <button
              data-testid="briefing-generate-brief"
              onClick={generateBrief}
              disabled={isGeneratingBrief}
              style={{
                background: isGeneratingBrief ? '#1c2333' : '#238636',
                border: '1px solid #3fb950',
                borderRadius: 6,
                padding: '8px 14px',
                color: '#fff',
                fontWeight: 700,
                fontSize: 12,
                cursor: isGeneratingBrief ? 'not-allowed' : 'pointer',
                opacity: isGeneratingBrief ? 0.6 : 1,
              }}
            >
              {isGeneratingBrief ? 'Preparing Brief…' : 'Generate Brief'}
            </button>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: '#8b949e', fontSize: 10, fontWeight: 700 }}>Video Briefer</span>
                <select
                  value={videoVoice}
                  onChange={(e) => setVideoVoice(e.target.value as VideoVoicePreset)}
                  disabled={isGeneratingVideo}
                  style={{
                    background: '#161b22',
                    border: '1px solid #30363d',
                    borderRadius: 6,
                    color: '#c9d1d9',
                    fontSize: 12,
                    padding: '7px 8px',
                  }}
                >
                  {VIDEO_VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: '#8b949e', fontSize: 10, fontWeight: 700 }}>Video Tone</span>
                <select
                  value={videoTone}
                  onChange={(e) => setVideoTone(e.target.value as VideoTone)}
                  disabled={isGeneratingVideo}
                  style={{
                    background: '#161b22',
                    border: '1px solid #30363d',
                    borderRadius: 6,
                    color: '#c9d1d9',
                    fontSize: 12,
                    padding: '7px 8px',
                  }}
                >
                  {VIDEO_TONES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label
                style={{
                  color: '#8b949e',
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={allowCursing}
                  onChange={(e) => setAllowCursing(e.target.checked)}
                  disabled={isGeneratingVideo}
                />
                Allow cursing
              </label>
            </div>
            <button
              data-testid="briefing-generate-video"
              onClick={createNarratedVideo}
              disabled={isGeneratingVideo || readySections.length === 0 || isGeneratingBrief}
              style={{
                background:
                  isGeneratingVideo || readySections.length === 0 || isGeneratingBrief
                    ? '#1c2333'
                    : '#6e40c9',
                border: '1px solid #8957e5',
                borderRadius: 6,
                padding: '8px 14px',
                color: '#fff',
                fontWeight: 600,
                fontSize: 12,
                cursor:
                  isGeneratingVideo || readySections.length === 0 || isGeneratingBrief
                    ? 'not-allowed'
                    : 'pointer',
                opacity: isGeneratingVideo || readySections.length === 0 || isGeneratingBrief ? 0.55 : 1,
              }}
            >
              {isGeneratingVideo ? `Creating Video… ${videoProgressPct}%` : 'Create Video Brief'}
            </button>
            <button
              data-testid="briefing-download-video"
              onClick={downloadGeneratedVideo}
              disabled={!generatedVideoUrl || isGeneratingVideo}
              style={{
                background: !generatedVideoUrl || isGeneratingVideo ? '#1c2333' : '#0f6fca',
                border: '1px solid #58a6ff',
                borderRadius: 6,
                padding: '8px 14px',
                color: '#fff',
                fontWeight: 600,
                fontSize: 12,
                cursor: !generatedVideoUrl || isGeneratingVideo ? 'not-allowed' : 'pointer',
                opacity: !generatedVideoUrl || isGeneratingVideo ? 0.55 : 1,
              }}
            >
              Download Video
            </button>
            <button
              data-testid="briefing-export-pdf"
              onClick={exportPDF}
              disabled={isExporting || readySections.length === 0}
              style={{
                background: isExporting || readySections.length === 0 ? '#1c2333' : '#1f6feb',
                border: '1px solid #388bfd',
                borderRadius: 6,
                padding: '8px 18px',
                color: '#fff',
                fontWeight: 600,
                fontSize: 13,
                cursor: isExporting || readySections.length === 0 ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                opacity: isExporting || readySections.length === 0 ? 0.5 : 1,
                transition: 'all 0.15s ease',
              }}
            >
              {isExporting ? 'Generating PDF…' : 'Download PDF'}
            </button>
            <button
              data-testid="briefing-close"
              onClick={() => setShowBriefing(false)}
              style={{
                background: '#1c2333',
                border: '1px solid #30363d',
                borderRadius: 6,
                padding: '8px 14px',
                color: '#8b949e',
                cursor: 'pointer',
                fontSize: 16,
              }}
            >
              ×
            </button>
          </div>
        </div>

        {(isGeneratingVideo || videoStatus) && (
          <div
            style={{
              padding: '10px 18px',
              borderBottom: '1px solid #21262d',
              background: '#0f1728',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 12,
                color: '#8b949e',
                marginBottom: 6,
              }}
            >
              <span>{videoStatus || 'Preparing video...'}</span>
              <span>{videoProgressPct}%</span>
            </div>
            <div
              style={{
                height: 8,
                borderRadius: 999,
                background: '#161b22',
                overflow: 'hidden',
                border: '1px solid #30363d',
              }}
            >
              <div
                style={{
                  width: `${videoProgressPct}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #8957e5, #58a6ff)',
                  transition: 'width 200ms ease',
                }}
              />
            </div>
          </div>
        )}

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Section nav */}
          <div
            style={{
              width: 240,
              background: '#0d1117',
              borderRight: '1px solid #21262d',
              overflowY: 'auto',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                padding: '10px 12px',
                color: '#8b949e',
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}
            >
              Intelligence Sections
            </div>
            {THEMES.map((theme) => {
              const state = sectionStates[theme.id];
              const active = activeSection === theme.id;
              const count = state?.kind === 'ready' ? state.section.citations.length : 0;
              return (
                <button
                  key={theme.id}
                  data-testid={`brief-section-${theme.id}`}
                  onClick={() => setActiveSection(theme.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 14px',
                    background: active ? '#1f6feb22' : 'transparent',
                    border: 'none',
                    borderLeft: active ? '3px solid #1f6feb' : '3px solid transparent',
                    cursor: 'pointer',
                    transition: 'all 0.12s ease',
                  }}
                >
                  <div
                    style={{
                      color: active ? '#e6edf3' : '#8b949e',
                      fontSize: 12,
                      fontWeight: 600,
                      lineHeight: 1.3,
                    }}
                  >
                    {theme.title}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    {state?.kind === 'loading' && (
                      <span style={{ color: '#3fb950', fontSize: 9, fontWeight: 700 }}>
                        PREPARING BRIEF…
                      </span>
                    )}
                    {state?.kind === 'error' && (
                      <span style={{ color: '#f85149', fontSize: 9, fontWeight: 700 }}>
                        ERROR
                      </span>
                    )}
                    <span style={{ color: '#6e7681', fontSize: 9 }}>{count} sources</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Section content */}
          <div ref={slideCaptureRef} style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
            {!currentState || currentState.kind === 'idle' ? (
              <div style={{ color: '#8b949e', fontSize: 13 }}>
                Click Generate Brief to begin.
              </div>
            ) : currentState.kind === 'loading' ? (
              <LoadingSection title={currentTheme.title} status={briefStatus} />
            ) : currentState.kind === 'error' ? (
              <ErrorSection
                title={currentTheme.title}
                reason={currentState.reason}
                hint={currentState.hint}
              />
            ) : (
              <ReadySection section={currentState.section} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingSection({ title, status }: { title: string; status: string }) {
  return (
    <div>
      <h2 style={{ color: '#e6edf3', fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
        {title}
      </h2>
      <div
        style={{
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 8,
          padding: 20,
          color: '#8b949e',
          fontSize: 13,
          lineHeight: 1.7,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#3fb950',
              display: 'inline-block',
              animation: 'pulse 1.5s infinite',
            }}
          />
          <span style={{ color: '#3fb950', fontWeight: 700, letterSpacing: 1 }}>
            PREPARING BRIEF
          </span>
        </div>
        {status || 'Preparing brief…'}
      </div>
    </div>
  );
}

function ErrorSection({
  title,
  reason,
  hint,
}: {
  title: string;
  reason: string;
  hint?: string;
}) {
  return (
    <div>
      <h2 style={{ color: '#e6edf3', fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
        {title}
      </h2>
      <div
        style={{
          background: '#161b22',
          border: '1px solid #f8514944',
          borderRadius: 8,
          padding: 20,
          color: '#c9d1d9',
          fontSize: 13,
          lineHeight: 1.7,
        }}
      >
        <div style={{ color: '#f85149', fontWeight: 700, marginBottom: 6 }}>
          Briefing generation failed
        </div>
        <div>{reason}</div>
        {hint && (
          <div style={{ marginTop: 8, color: '#8b949e', fontSize: 12 }}>{hint}</div>
        )}
      </div>
    </div>
  );
}

function ReadySection({ section }: { section: BriefSection }) {
  const hideMapForSection = section.id === 'domestic-financial' || section.id === 'washington';
  return (
    <div>
      <div
        style={{
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 6,
          padding: '6px 14px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
        }}
      >
        <span style={{ color: '#3fb950', fontSize: 10, fontWeight: 700 }}>
          {section.classification}
        </span>
        {section.modelUsed && (
          <>
            <span style={{ color: '#30363d', margin: '0 4px' }}>|</span>
            <span style={{ color: '#6e7681', fontSize: 10 }}>via {section.modelUsed}</span>
          </>
        )}
      </div>

      <h2
        style={{
          color: '#e6edf3',
          fontSize: 22,
          fontWeight: 700,
          marginBottom: 6,
          lineHeight: 1.2,
        }}
      >
        {section.title}
      </h2>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {section.regions.map((r) => (
          <span
            key={r}
            style={{
              background: '#1f6feb22',
              border: '1px solid #1f6feb44',
              color: '#58a6ff',
              fontSize: 11,
              padding: '2px 10px',
              borderRadius: 10,
              fontWeight: 500,
            }}
          >
            {r}
          </span>
        ))}
        <span
          style={{
            background: '#21262d',
            border: '1px solid #30363d',
            color: '#8b949e',
            fontSize: 11,
            padding: '2px 10px',
            borderRadius: 10,
          }}
        >
          {section.citations.length} cited source{section.citations.length === 1 ? '' : 's'} ·{' '}
          {section.sources.join(', ')}
        </span>
      </div>

      {(!hideMapForSection && section.visuals?.map) || (section.visuals?.images?.length ?? 0) > 0 ? (
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              color: '#8b949e',
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: 10,
            }}
          >
            Visual Intelligence (Map + Imagery)
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                !hideMapForSection && section.visuals?.map
                  ? 'minmax(320px, 1fr) minmax(320px, 1fr)'
                  : 'minmax(320px, 1fr)',
              gap: 12,
            }}
          >
            {!hideMapForSection && section.visuals?.map && (
              <div
                style={{
                  background: '#161b22',
                  border: '1px solid #30363d',
                  borderRadius: 8,
                  overflow: 'hidden',
                  minHeight: 270,
                }}
              >
                <IntelMapCard
                  sectionId={section.id}
                  map={section.visuals?.map}
                  regions={section.regions}
                  threatLevel={section.threatLevel}
                />
              </div>
            )}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 8,
                alignContent: 'start',
              }}
            >
              {(section.visuals?.images ?? []).slice(0, 4).map((img) => (
                <a
                  key={img.imageUrl}
                  href={img.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    background: '#161b22',
                    border: '1px solid #30363d',
                    borderRadius: 8,
                    overflow: 'hidden',
                    textDecoration: 'none',
                    color: '#c9d1d9',
                  }}
                >
                  <img
                    src={img.imageUrl}
                    alt={img.title}
                    loading="lazy"
                    style={{
                      width: '100%',
                      height: 116,
                      objectFit: 'cover',
                      background: '#0d1117',
                      display: 'block',
                    }}
                  />
                  <div
                    style={{
                      fontSize: 11,
                      lineHeight: 1.4,
                      padding: '6px 8px',
                      maxHeight: 54,
                      overflow: 'hidden',
                    }}
                    title={img.title}
                  >
                    {img.title}
                  </div>
                </a>
              ))}
              {(section.visuals?.images?.length ?? 0) === 0 && (
                <div
                  style={{
                    gridColumn: '1 / span 2',
                    background: '#161b22',
                    border: '1px dashed #30363d',
                    borderRadius: 8,
                    minHeight: 270,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#6e7681',
                    fontSize: 12,
                    padding: 12,
                    textAlign: 'center',
                  }}
                >
                  No embeddable article images returned by source pages for this section.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div
        style={{
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 8,
          padding: '16px 20px',
          marginBottom: 20,
        }}
      >
        <div
          style={{
            color: '#8b949e',
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 8,
          }}
        >
          Executive Summary (Web Research)
        </div>
        <p style={{ color: '#c9d1d9', fontSize: 14, lineHeight: 1.7, margin: 0 }}>
          {section.summary}
        </p>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            color: '#8b949e',
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 12,
          }}
        >
          Key Intelligence Points
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {section.keyPoints.map((point, i) => (
            <div
              key={i}
              data-testid={`brief-point-${section.id}-${i}`}
              style={{
                display: 'flex',
                gap: 12,
                background: '#161b22',
                border: '1px solid #21262d',
                borderRadius: 8,
                padding: '12px 16px',
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: '#1f6feb',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {i + 1}
              </span>
              <span style={{ color: '#c9d1d9', fontSize: 13, lineHeight: 1.5 }}>
                {point}
              </span>
            </div>
          ))}
        </div>
      </div>

      {section.indicators.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              color: '#8b949e',
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            Indicators to watch (next 48h)
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: '#c9d1d9', fontSize: 13, lineHeight: 1.7 }}>
            {section.indicators.map((ind, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {ind}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        style={{
          marginBottom: 20,
          background: '#161b22',
          border: '1px solid #30363d',
          borderLeft: '3px solid #3fb950',
          borderRadius: 8,
          padding: '12px 14px',
        }}
      >
        <div
          style={{
            color: '#3fb950',
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 6,
          }}
        >
          Strategic Implication (U.S. National Interests)
        </div>
        <div style={{ color: '#c9d1d9', fontSize: 13, lineHeight: 1.6 }}>
          {section.strategicImplication}
        </div>
      </div>

      {section.citations.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              color: '#8b949e',
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            OSINT sources (Google Search)
            {section.searchQueries.length > 0 && (
              <span style={{ color: '#6e7681', fontWeight: 500, marginLeft: 6 }}>
                · queries: {section.searchQueries.slice(0, 3).join(' · ')}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {section.citations.map((c) => (
              <a
                key={c.uri}
                href={c.uri}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  background: '#21262d',
                  border: '1px solid #30363d',
                  color: '#58a6ff',
                  fontSize: 11,
                  padding: '3px 10px',
                  borderRadius: 10,
                  textDecoration: 'none',
                  maxWidth: 280,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={c.uri}
              >
                {c.title}
              </a>
            ))}
          </div>
        </div>
      )}

      <div>
        <div
          style={{
            color: '#8b949e',
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 12,
          }}
        >
          Section Blueprint (from prompt)
        </div>
        <div
          style={{
            background: '#0d1117',
            border: '1px solid #21262d',
            borderRadius: 6,
            padding: '10px 12px',
            color: '#c9d1d9',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          This section is generated from web search only and follows the required Presidential
          Daily Brief format.
        </div>
      </div>
    </div>
  );
}

const INTEL_CONTINENT_POLYS: Array<Array<[number, number]>> = [
  // North America
  [
    [-168, 13],
    [-162, 52],
    [-145, 68],
    [-120, 72],
    [-95, 70],
    [-72, 52],
    [-82, 27],
    [-104, 18],
    [-130, 10],
  ],
  // South America
  [
    [-82, 12],
    [-68, 8],
    [-54, -4],
    [-48, -18],
    [-55, -36],
    [-68, -54],
    [-77, -30],
  ],
  // Europe + Asia (very simplified)
  [
    [-10, 35],
    [5, 46],
    [28, 56],
    [56, 64],
    [84, 61],
    [114, 54],
    [144, 45],
    [158, 26],
    [146, 8],
    [112, 6],
    [84, 15],
    [58, 22],
    [36, 34],
    [14, 35],
  ],
  // Africa
  [
    [-20, 35],
    [10, 36],
    [26, 26],
    [33, 8],
    [38, -12],
    [28, -33],
    [12, -36],
    [-4, -24],
    [-14, -4],
  ],
  // Australia
  [
    [112, -11],
    [132, -10],
    [152, -25],
    [148, -42],
    [122, -43],
    [112, -30],
  ],
  // Greenland
  [
    [-73, 60],
    [-54, 60],
    [-28, 73],
    [-42, 83],
    [-60, 80],
    [-72, 70],
  ],
  // Arabian Peninsula
  [
    [36, 31],
    [49, 30],
    [56, 20],
    [53, 12],
    [44, 13],
    [38, 21],
  ],
  // India
  [
    [68, 24],
    [79, 31],
    [89, 23],
    [86, 10],
    [76, 8],
    [70, 18],
  ],
  // Japan
  [
    [130, 31],
    [137, 36],
    [144, 43],
    [141, 31],
  ],
  // UK + Ireland
  [
    [-10, 50],
    [-2, 58],
    [2, 54],
    [-4, 50],
  ],
  // Madagascar
  [
    [45, -13],
    [50, -16],
    [49, -25],
    [45, -23],
  ],
];

type GeoJsonGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

type GeoJsonFeature = {
  geometry?: GeoJsonGeometry | null;
};

type GeoJsonFeatureCollection = {
  type: 'FeatureCollection';
  features?: GeoJsonFeature[];
};

const DETAILED_WORLD_GEOJSON_URLS = [
  'https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson',
  'https://cdn.jsdelivr.net/gh/holtzy/D3-graph-gallery@master/DATA/world.geojson',
];

let detailedWorldPolysCache: Array<Array<[number, number]>> | null = null;
let detailedWorldPolysPromise: Promise<Array<Array<[number, number]>> | null> | null = null;

function normalizeGeoJsonPolys(raw: unknown): Array<Array<[number, number]>> {
  const parsed = raw as GeoJsonFeatureCollection;
  const out: Array<Array<[number, number]>> = [];
  const features = Array.isArray(parsed?.features) ? parsed.features : [];
  for (const feature of features) {
    const g = feature?.geometry;
    if (!g) continue;
    if (g.type === 'Polygon' && Array.isArray(g.coordinates) && Array.isArray(g.coordinates[0])) {
      const ring = g.coordinates[0]
        .filter((p): p is number[] => Array.isArray(p) && p.length >= 2)
        .map((p) => [Number(p[0]), Number(p[1])] as [number, number]);
      if (ring.length > 3) out.push(ring);
      continue;
    }
    if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
      for (const polygon of g.coordinates) {
        const ringRaw = Array.isArray(polygon) ? polygon[0] : null;
        if (!Array.isArray(ringRaw)) continue;
        const ring = ringRaw
          .filter((p): p is number[] => Array.isArray(p) && p.length >= 2)
          .map((p) => [Number(p[0]), Number(p[1])] as [number, number]);
        if (ring.length > 3) out.push(ring);
      }
    }
  }
  return out;
}

async function ensureDetailedWorldPolys(): Promise<Array<Array<[number, number]>> | null> {
  if (detailedWorldPolysCache) return detailedWorldPolysCache;
  if (detailedWorldPolysPromise) return detailedWorldPolysPromise;
  detailedWorldPolysPromise = (async () => {
    for (const url of DETAILED_WORLD_GEOJSON_URLS) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const json = await res.json();
        const polys = normalizeGeoJsonPolys(json);
        if (polys.length > 0) {
          detailedWorldPolysCache = polys;
          return polys;
        }
      } catch {
        continue;
      }
    }
    return null;
  })();
  const result = await detailedWorldPolysPromise;
  detailedWorldPolysPromise = null;
  return result;
}

function approxCenterForRegion(region: string): { lat: number; lon: number } | null {
  const r = region.toLowerCase();
  if (r.includes('ukraine')) return { lat: 49, lon: 31 };
  if (r.includes('russia')) return { lat: 56, lon: 38 };
  if (r.includes('middle east') || r.includes('iran') || r.includes('israel')) return { lat: 31, lon: 45 };
  if (r.includes('europe')) return { lat: 51, lon: 13 };
  if (r.includes('asia') || r.includes('indopacom') || r.includes('china')) return { lat: 32, lon: 105 };
  if (r.includes('africa')) return { lat: 7, lon: 20 };
  if (r.includes('southcom') || r.includes('south america')) return { lat: -15, lon: -60 };
  if (r.includes('north america') || r.includes('domestic') || r.includes('washington')) return { lat: 39, lon: -98 };
  return null;
}

function projectLonLat(lon: number, lat: number, width: number, height: number): { x: number; y: number } {
  const x = ((lon + 180) / 360) * width;
  const y = ((90 - lat) / 180) * height;
  return { x, y };
}

type MapViewport = {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
};

function viewportForSection(
  sectionId: string | undefined,
  regions: string[],
  map?: BriefVisualMap,
): MapViewport {
  if (sectionId === 'executive') {
    return { minLon: -180, maxLon: 180, minLat: -85, maxLat: 85 };
  }
  if (sectionId === 'eucom') {
    return { minLon: -20, maxLon: 80, minLat: 25, maxLat: 72 };
  }
  if (sectionId === 'centcom') {
    return { minLon: 20, maxLon: 75, minLat: 8, maxLat: 45 };
  }
  if (sectionId === 'indopacom') {
    return { minLon: 70, maxLon: 165, minLat: -20, maxLat: 55 };
  }
  if (sectionId === 'africom-southcom') {
    return { minLon: -85, maxLon: 55, minLat: -45, maxLat: 35 };
  }

  // Fallback: infer a regional window around the map focus/region center.
  const inferred =
    map ?? regions.map((r) => approxCenterForRegion(r)).find((v): v is { lat: number; lon: number } => Boolean(v));
  if (inferred) {
    const lonSpan = 55;
    const latSpan = 36;
    return {
      minLon: Math.max(-180, inferred.lon - lonSpan),
      maxLon: Math.min(180, inferred.lon + lonSpan),
      minLat: Math.max(-85, inferred.lat - latSpan),
      maxLat: Math.min(85, inferred.lat + latSpan),
    };
  }
  return { minLon: -180, maxLon: 180, minLat: -85, maxLat: 85 };
}

function projectLonLatViewport(
  lon: number,
  lat: number,
  width: number,
  height: number,
  viewport: MapViewport,
): { x: number; y: number } {
  const x = ((lon - viewport.minLon) / (viewport.maxLon - viewport.minLon)) * width;
  const y = ((viewport.maxLat - lat) / (viewport.maxLat - viewport.minLat)) * height;
  return { x, y };
}

function drawPoly(
  ctx: CanvasRenderingContext2D,
  poly: Array<[number, number]>,
  width: number,
  height: number,
  viewport?: MapViewport,
): void {
  if (poly.length === 0) return;
  const project = (lon: number, lat: number) =>
    viewport ? projectLonLatViewport(lon, lat, width, height, viewport) : projectLonLat(lon, lat, width, height);

  const first = project(poly[0][0], poly[0][1]);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < poly.length; i++) {
    const p = project(poly[i][0], poly[i][1]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawIntelMapSurface(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  {
    sectionId,
    map,
    regions,
    threatLevel,
    showFooter = true,
    showLabels = true,
  }: {
    sectionId?: string;
    map?: BriefVisualMap;
    regions: string[];
    threatLevel: BriefSection['threatLevel'];
    showFooter?: boolean;
    showLabels?: boolean;
  },
): void {
  const viewport = viewportForSection(sectionId, regions, map);
  const project = (lon: number, lat: number) => projectLonLatViewport(lon, lat, width, height, viewport);
  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#07121f');
  bg.addColorStop(0.5, '#0c1c30');
  bg.addColorStop(1, '#09182a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Finer graticule for more visual detail.
  ctx.strokeStyle = 'rgba(124, 158, 196, 0.18)';
  ctx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 15) {
    if (lon < viewport.minLon || lon > viewport.maxLon) continue;
    const x = ((lon - viewport.minLon) / (viewport.maxLon - viewport.minLon)) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    if (lat < viewport.minLat || lat > viewport.maxLat) continue;
    const y = ((viewport.maxLat - lat) / (viewport.maxLat - viewport.minLat)) * height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Highlight key parallels.
  ctx.strokeStyle = 'rgba(170, 198, 226, 0.25)';
  ctx.lineWidth = 1.2;
  const notableLatitudes = [0, 23.5, -23.5];
  for (const lat of notableLatitudes) {
    if (lat < viewport.minLat || lat > viewport.maxLat) continue;
    const y = ((viewport.maxLat - lat) / (viewport.maxLat - viewport.minLat)) * height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const landPolys = detailedWorldPolysCache ?? INTEL_CONTINENT_POLYS;
  ctx.fillStyle = detailedWorldPolysCache ? '#2b4255' : '#2a455b';
  ctx.strokeStyle = detailedWorldPolysCache ? 'rgba(133, 164, 189, 0.45)' : '#6f93ad';
  ctx.lineWidth = detailedWorldPolysCache ? 0.5 : 1.2;
  for (const poly of landPolys) {
    drawPoly(ctx, poly, width, height, viewport);
  }

  const hotspots: Array<{ lat: number; lon: number; label: string }> = [];
  if (map) hotspots.push({ lat: map.lat, lon: map.lon, label: map.label });
  for (const region of regions) {
    const c = approxCenterForRegion(region);
    if (c) hotspots.push({ lat: c.lat, lon: c.lon, label: region });
  }
  const unique = new Map<string, { lat: number; lon: number; label: string }>();
  for (const h of hotspots) unique.set(`${h.lat.toFixed(2)},${h.lon.toFixed(2)}`, h);
  const hotspotList = Array.from(unique.values());

  const threatColor =
    threatLevel === 'CRITICAL'
      ? '#f85149'
      : threatLevel === 'HIGH'
        ? '#f0883e'
        : threatLevel === 'MEDIUM'
          ? '#d29922'
          : '#3fb950';

  // Connect hotspots to suggest networked activity.
  if (hotspotList.length > 1) {
    ctx.strokeStyle = 'rgba(120, 180, 230, 0.35)';
    ctx.lineWidth = 1.1;
    ctx.setLineDash([5, 5]);
    for (let i = 0; i < hotspotList.length - 1; i++) {
      const a = projectLonLat(hotspotList[i].lon, hotspotList[i].lat, width, height);
      const b = projectLonLat(hotspotList[i + 1].lon, hotspotList[i + 1].lat, width, height);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  for (const h of hotspotList) {
    const { x, y } = project(h.lon, h.lat);

    // Soft heat glow
    const glow = ctx.createRadialGradient(x, y, 2, x, y, 38);
    glow.addColorStop(0, `${threatColor}cc`);
    glow.addColorStop(0.45, `${threatColor}55`);
    glow.addColorStop(1, `${threatColor}00`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 38, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `${threatColor}88`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = threatColor;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();

    if (showLabels) {
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(6, 16, 28, 0.84)';
      const label = h.label.length > 24 ? `${h.label.slice(0, 24)}…` : h.label;
      const textW = ctx.measureText(label).width + 10;
      ctx.fillRect(x + 8, y - 14, textW, 16);
      ctx.strokeStyle = 'rgba(140, 165, 190, 0.45)';
      ctx.strokeRect(x + 8, y - 14, textW, 16);
      ctx.fillStyle = '#d7e4f2';
      ctx.fillText(label, x + 13, y - 3);
    }
  }

  if (showLabels) {
    const mapLabels: Array<{ name: string; lon: number; lat: number }> = [
      { name: 'N. America', lon: -110, lat: 48 },
      { name: 'S. America', lon: -60, lat: -20 },
      { name: 'Europe', lon: 12, lat: 54 },
      { name: 'Africa', lon: 18, lat: 6 },
      { name: 'Asia', lon: 95, lat: 48 },
      { name: 'Australia', lon: 133, lat: -25 },
    ];
    ctx.fillStyle = 'rgba(214, 229, 242, 0.65)';
    ctx.font = '10px Inter, system-ui, sans-serif';
    for (const label of mapLabels) {
      if (
        label.lon < viewport.minLon ||
        label.lon > viewport.maxLon ||
        label.lat < viewport.minLat ||
        label.lat > viewport.maxLat
      ) {
        continue;
      }
      const p = project(label.lon, label.lat);
      ctx.fillText(label.name, p.x, p.y);
    }

    // Longitude labels (bottom)
    ctx.fillStyle = 'rgba(186, 208, 229, 0.45)';
    ctx.font = '9px JetBrains Mono, monospace';
    for (let lon = -150; lon <= 150; lon += 30) {
      if (lon < viewport.minLon || lon > viewport.maxLon) continue;
      const x = ((lon - viewport.minLon) / (viewport.maxLon - viewport.minLon)) * width;
      ctx.fillText(`${lon}°`, x - 10, height - (showFooter ? 30 : 8));
    }
    // Latitude labels (left)
    for (let lat = -60; lat <= 60; lat += 30) {
      if (lat < viewport.minLat || lat > viewport.maxLat) continue;
      const y = ((viewport.maxLat - lat) / (viewport.maxLat - viewport.minLat)) * height;
      ctx.fillText(`${lat}°`, 4, y - 2);
    }
  }

  if (showFooter) {
    ctx.fillStyle = 'rgba(7, 15, 26, 0.82)';
    ctx.fillRect(0, height - 26, width, 26);
    ctx.fillStyle = '#c9d8e6';
    ctx.font = '12px Inter, system-ui, sans-serif';
    const focus = map ? `${map.label} (${map.lat.toFixed(1)}, ${map.lon.toFixed(1)})` : 'Global focus';
    ctx.fillText(`Intel Map • Focus: ${focus} • Hotspots: ${hotspotList.length}`, 10, height - 9);
  }
}

async function buildIntelMapDataUrl(
  sectionId: string,
  map: BriefVisualMap | undefined,
  regions: string[],
  threatLevel: BriefSection['threatLevel'],
  width: number,
  height: number,
): Promise<string | null> {
  await ensureDetailedWorldPolys();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawIntelMapSurface(ctx, width, height, {
    sectionId,
    map,
    regions,
    threatLevel,
    showFooter: false,
    showLabels: true,
  });
  return canvas.toDataURL('image/png');
}

function IntelMapCard({
  sectionId,
  map,
  regions,
  threatLevel,
}: {
  sectionId: string;
  map?: BriefVisualMap;
  regions: string[];
  threatLevel: BriefSection['threatLevel'];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    (async () => {
      await ensureDetailedWorldPolys();
      if (cancelled) return;
      drawIntelMapSurface(ctx, canvas.width, canvas.height, {
        sectionId,
        map,
        regions,
        threatLevel,
        showFooter: true,
        showLabels: true,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [sectionId, map, regions, threatLevel]);

  return (
    <>
      <canvas
        ref={canvasRef}
        width={860}
        height={460}
        style={{ width: '100%', height: 230, display: 'block', background: '#0b1524' }}
      />
      <div style={{ padding: '8px 10px', color: '#8b949e', fontSize: 11 }}>
        Custom rendered intelligence map with regional hotspots and geospatial overlays.
      </div>
    </>
  );
}
