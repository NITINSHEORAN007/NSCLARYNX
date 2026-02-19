
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { AppLanguage, AppMode, TranscriptionItem, VoiceOption, VoiceStyle, VoiceAgeRange } from './types';
import { encode, decode, decodeAudioData, audioBufferToWav } from './utils/audioUtils';
import { Visualizer } from './components/Visualizer';

const App: React.FC = () => {
  const [view, setView] = useState<'landing' | 'app'>('landing');
  const [isActive, setIsActive] = useState(false);
  const [language, setLanguage] = useState<AppLanguage>(AppLanguage.ENGLISH);
  const [mode, setMode] = useState<AppMode>(AppMode.TRANSCRIBE);
  const [voice, setVoice] = useState<VoiceOption>('Nitin'); 
  const [voiceStyle, setVoiceStyle] = useState<VoiceStyle>('Standard');
  const [ageRange, setAgeRange] = useState<VoiceAgeRange>(VoiceAgeRange.ADULT);
  const [vocalPitch, setVocalPitch] = useState<number>(1.0);
  const [vocalSpeed, setVocalSpeed] = useState<number>(1.0);
  const [history, setHistory] = useState<TranscriptionItem[]>([]);
  const [currentText, setCurrentText] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [isGeneratingTTS, setIsGeneratingTTS] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [lastGeneratedAudioBlob, setLastGeneratedAudioBlob] = useState<Blob | null>(null);

  // Cloning State
  const [clonedVoiceBase64, setClonedVoiceBase64] = useState<string | null>(null);
  const [isRecordingClone, setIsRecordingClone] = useState(false);
  const [cloneTimeLeft, setCloneTimeLeft] = useState(5);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const previewAudioContextRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sessionRef = useRef<any>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  const currentTranscriptionRef = useRef<string>('');
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const cloneAudioChunks = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const voiceMetadata: Record<VoiceOption, { label: string, desc: string, color: string, badge: string }> = {
    'Nitin': { label: 'Nitin', desc: 'Premium Hindi Native • High Fidelity', color: 'amber', badge: 'PRO' },
    'Narrator': { label: 'Narrator', desc: 'Deep Dramatic Storyteller', color: 'rose', badge: 'PREMIUM' },
    'Anchor': { label: 'Anchor', desc: 'Sharp Broadcast Enunciation', color: 'blue', badge: 'PREMIUM' },
    'Vlogger': { label: 'Vlogger', desc: 'Expressive High-Energy Casual', color: 'orange', badge: 'PREMIUM' },
    'Zephyr': { label: 'Zephyr', desc: 'Warm & Conversational', color: 'indigo', badge: 'NATURAL' },
    'Kore': { label: 'Kore', desc: 'Bright & Energetic Storyteller', color: 'violet', badge: 'BOLD' },
    'Charon': { label: 'Charon', desc: 'Deep Authoritative Resonance', color: 'slate', badge: 'DEEP' },
    'Puck': { label: 'Puck', desc: 'Fast-paced & Playful Youth', color: 'sky', badge: 'LITE' },
    'Clone': { label: 'Custom', desc: 'AI Voice Replica Engine', color: 'emerald', badge: 'LAB' }
  };

  const getPrebuiltVoiceName = (v: VoiceOption): string => {
    if (v === 'Nitin') return 'Fenrir';
    if (v === 'Narrator') return 'Charon';
    if (v === 'Anchor') return 'Zephyr';
    if (v === 'Vlogger') return 'Kore';
    if (v === 'Clone') return 'Fenrir'; // Default for clone synth if not in live
    return v;
  };

  const getVocalInstruction = useCallback(() => {
    let base = `Vocal Pitch: ${vocalPitch.toFixed(1)}x. Speed: ${vocalSpeed.toFixed(1)}x. Style: ${voiceStyle.toLowerCase()}. Age: ${ageRange.toLowerCase()}.`;
    base += " Output must be studio-quality, crystal clear, zero background noise, ultra high fidelity.";

    if (voice === 'Narrator') {
      base += " Personality: Deep, dramatic, captures the listener's attention with storytelling cadence.";
    } else if (voice === 'Anchor') {
      base += " Personality: Professional TV news anchor, sharp enunciation, trustworthy tone.";
    } else if (voice === 'Vlogger') {
      base += " Personality: High-energy, modern, friendly, highly expressive.";
    }

    if (language === AppLanguage.HINDI) {
      base += " Focus on perfect Hindi grammar and accent (शुद्ध उच्चारण).";
    }
    return base;
  }, [vocalPitch, vocalSpeed, voiceStyle, ageRange, voice, language]);

  const stopSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current = null;
    }
    setIsActive(false);
    if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
    if (outputAudioContextRef.current) outputAudioContextRef.current.close().catch(() => {});
    
    sourcesRef.current.forEach(s => {
      try { s.stop(); } catch(e) {}
    });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('audio/')) {
      setError('Invalid file type. Please upload an audio file.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('File too large. Max 10MB.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      setClonedVoiceBase64(base64);
      setVoice('Clone');
    };
    reader.onerror = () => {
      setError('Failed to read file.');
    };
    reader.readAsDataURL(file);
    if (event.target) event.target.value = '';
  };

  const recordCloneVoice = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      cloneAudioChunks.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) cloneAudioChunks.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        if (cloneAudioChunks.current.length === 0) {
          setError('Recording failed: No data.');
          return;
        }
        const blob = new Blob(cloneAudioChunks.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          setClonedVoiceBase64(base64);
          setVoice('Clone');
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      setIsRecordingClone(true);
      setCloneTimeLeft(5);
      mediaRecorder.start();

      const timer = setInterval(() => {
        setCloneTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
            setIsRecordingClone(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

    } catch (err: any) {
      setError('Microphone access denied.');
      setIsRecordingClone(false);
    }
  };

  const tryVoicePreview = async (v: VoiceOption) => {
    if (previewSourceRef.current) {
      try { previewSourceRef.current.stop(); } catch(e) {}
      previewSourceRef.current = null;
    }
    
    setIsPreviewing(v);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const previewText = language === AppLanguage.HINDI 
        ? `नमस्ते, मैं ${voiceMetadata[v].label} हूँ।`
        : `Hello, I am ${voiceMetadata[v].label}. Checking audio quality.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `${getVocalInstruction()} Read: ${previewText}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: getPrebuiltVoiceName(v) as any } }
          }
        }
      });

      const audioPart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (audioPart?.inlineData?.data) {
        if (!previewAudioContextRef.current) previewAudioContextRef.current = new AudioContext({ sampleRate: 24000 });
        const audioCtx = previewAudioContextRef.current;
        const buffer = await decodeAudioData(decode(audioPart.inlineData.data), audioCtx, 24000, 1);
        const sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = buffer;
        sourceNode.connect(audioCtx.destination);
        previewSourceRef.current = sourceNode;
        sourceNode.start();
        sourceNode.onended = () => setIsPreviewing(null);
      } else {
        setIsPreviewing(null);
      }
    } catch (err) {
      setError('Preview failed.');
      setIsPreviewing(null);
    }
  };

  const startSession = async () => {
    try {
      setError(null);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      const analyser = inputCtx.createAnalyser();
      analyser.fftSize = 256;
      
      audioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;
      analyserRef.current = analyser;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = inputCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const systemInstruction = `Vocal Lab Engine. Mode: ${mode}. Language: ${language}. ${getVocalInstruction()}`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            // FIXED: Removed invalid nested voiceConfig property
            voiceConfig: { prebuiltVoiceConfig: { voiceName: getPrebuiltVoiceName(voice) as any } }
          }
        },
        callbacks: {
          onopen: () => {
            setIsActive(true);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              const pcmBlob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
              sessionPromise.then((session) => { if (isActive) session.sendRealtimeInput({ media: pcmBlob }); });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData) {
              const audioCtx = outputAudioContextRef.current!;
              const buffer = await decodeAudioData(decode(audioData), audioCtx, 24000, 1);
              const sourceNode = audioCtx.createBufferSource();
              sourceNode.buffer = buffer;
              sourceNode.connect(audioCtx.destination);
              const playTime = Math.max(nextStartTimeRef.current, audioCtx.currentTime + 0.05);
              sourceNode.start(playTime);
              nextStartTimeRef.current = playTime + buffer.duration;
              sourcesRef.current.add(sourceNode);
              sourceNode.onended = () => sourcesRef.current.delete(sourceNode);
            }
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              currentTranscriptionRef.current += text;
              setCurrentText(prev => prev + text);
            }
            if (message.serverContent?.turnComplete) {
              if (currentTranscriptionRef.current.trim()) {
                setHistory(prev => [{ id: Date.now().toString(), text: currentTranscriptionRef.current, timestamp: new Date(), sender: 'user' }, ...prev]);
              }
              currentTranscriptionRef.current = '';
              setCurrentText('');
            }
          },
          onerror: () => stopSession(),
          onclose: () => stopSession()
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err: any) {
      setError(`Connection failed: ${err.message || 'Unknown Error'}`);
    }
  };

  const generateScriptSpeech = async () => {
    if (!scriptText.trim()) return;
    setIsGeneratingTTS(true);
    setLastGeneratedAudioBlob(null);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const promptText = `High Fidelity Speech. ${getVocalInstruction()}. Read the following text: ${scriptText}`;

      // FIXED: Using stable TTS model for synthesis to prevent failures during direct generateContent calls
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: promptText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: getPrebuiltVoiceName(voice) as any
              }
            }
          }
        }
      });

      const audioPart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (audioPart?.inlineData?.data) {
        if (!outputAudioContextRef.current) outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });
        const audioCtx = outputAudioContextRef.current;
        const buffer = await decodeAudioData(decode(audioPart.inlineData.data), audioCtx, 24000, 1);
        const wavBlob = audioBufferToWav(buffer);
        setLastGeneratedAudioBlob(wavBlob);
        const sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = buffer;
        sourceNode.connect(audioCtx.destination);
        sourceNode.start();
        sourcesRef.current.add(sourceNode);
      } else {
        setError('Synthesis yielded no audio data.');
      }
    } catch (err: any) {
      setError(`Synthesis failed: ${err.message || 'API Error'}`);
    } finally {
      setIsGeneratingTTS(false);
    }
  };

  const toggleRecording = () => {
    if (isActive) stopSession();
    else startSession();
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(id);
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center selection:bg-indigo-100">
        <nav className="w-full max-w-7xl px-8 py-10 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="bg-indigo-600 p-2.5 rounded-2xl shadow-lg rotate-3">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
            </div>
            <span className="text-2xl font-black text-slate-900 tracking-tighter uppercase">NSCLARYNX</span>
          </div>
          <div className="hidden md:flex items-center gap-10">
            <a href="#" className="text-xs font-black text-slate-400 uppercase tracking-widest hover:text-indigo-600 transition-colors">Features</a>
            <a href="#" className="text-xs font-black text-slate-400 uppercase tracking-widest hover:text-indigo-600 transition-colors">Lab Docs</a>
            <button onClick={() => setView('app')} className="px-8 py-3 bg-slate-900 text-white text-xs font-black rounded-full shadow-2xl shadow-indigo-200/50 hover:scale-105 active:scale-95 transition-all uppercase tracking-widest">Launch Lab</button>
          </div>
        </nav>

        <main className="w-full max-w-5xl px-8 py-20 text-center flex flex-col items-center">
          <div className="inline-flex items-center gap-3 px-6 py-2 bg-indigo-50 rounded-full text-indigo-600 text-[10px] font-black uppercase tracking-widest mb-10 animate-fade-in">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
            </span>
            V2.8.5 Engine Now Active
          </div>
          <h1 className="text-6xl md:text-8xl font-black text-slate-900 tracking-tighter leading-[0.9] mb-10">
            Next-Gen Vocal <br/>
            <span className="text-indigo-600">Enunciation</span> Lab.
          </h1>
          <p className="text-xl text-slate-400 max-w-2xl leading-relaxed mb-12 font-medium">
            Professional-grade speech-to-text, translation, and high-fidelity vocal cloning 
            for Hindi and English. Powered by Gemini Native Audio for zero-latency clarity.
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <button onClick={() => setView('app')} className="group px-12 py-6 bg-indigo-600 text-white text-sm font-black rounded-[2.5rem] shadow-[0_20px_60px_rgba(79,70,229,0.3)] hover:scale-105 active:scale-95 transition-all uppercase tracking-widest flex items-center gap-4">
              Enter the Studio
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className="group-hover:translate-x-1 transition-transform"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
            <button className="px-12 py-6 text-slate-500 text-sm font-black border-2 border-slate-200 rounded-[2.5rem] hover:bg-slate-50 transition-all uppercase tracking-widest">
              View Source
            </button>
          </div>

          <div className="mt-32 w-full grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
               <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600 mb-6 font-black text-xl">HI</div>
               <h3 className="text-lg font-black text-slate-800 mb-2 uppercase tracking-tight">Native Hindi Synth</h3>
               <p className="text-sm text-slate-400 leading-relaxed">Perfect Devanagari enunciation with regional dialect support and natural rhythm.</p>
            </div>
            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
               <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 mb-6 font-black text-xl">CL</div>
               <h3 className="text-lg font-black text-slate-800 mb-2 uppercase tracking-tight">Instant Cloning</h3>
               <p className="text-sm text-slate-400 leading-relaxed">Clone any voice with a 5-second sample. High-fidelity mimicry for professional scripts.</p>
            </div>
            <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
               <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 mb-6 font-black text-xl">RT</div>
               <h3 className="text-lg font-black text-slate-800 mb-2 uppercase tracking-tight">Real-Time Flow</h3>
               <p className="text-sm text-slate-400 leading-relaxed">Sub-100ms latency for live captioning and translation sessions. Zero buffering.</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center bg-[#f4f7f9] selection:bg-indigo-100 selection:text-indigo-900">
      <header className="w-full bg-white/70 backdrop-blur-xl border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-8 h-20 flex justify-between items-center">
          <div className="flex items-center gap-8">
            <button onClick={() => setView('landing')} className="flex items-center gap-3 group">
              <div className="bg-indigo-600 p-2 rounded-xl group-hover:rotate-12 transition-transform shadow-indigo-200 shadow-lg">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
              </div>
              <h1 className="text-xl font-black text-slate-900 tracking-tighter uppercase">NSCLARYNX</h1>
            </button>
            <div className="hidden lg:flex bg-slate-100 p-1 rounded-2xl">
              {Object.values(AppMode).map(m => (
                <button 
                  key={m}
                  onClick={() => { stopSession(); setMode(m); }}
                  className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all ${
                    mode === m ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {m.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4">
             <div className="flex items-center gap-2 bg-emerald-50 px-4 py-2 rounded-full border border-emerald-100">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Server Active</span>
             </div>
             <button onClick={() => setView('landing')} className="text-slate-400 hover:text-red-500 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
             </button>
          </div>
        </div>
      </header>

      <main className="w-full max-w-[1600px] p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Control Panel */}
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-white rounded-[2.5rem] p-8 shadow-xl border border-slate-100">
            <h2 className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.3em] mb-8">Persona Config</h2>
            
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Vocal Architecture</label>
                <div className="grid grid-cols-1 gap-2 max-h-[350px] overflow-y-auto no-scrollbar pr-1">
                  {(['Nitin', 'Narrator', 'Anchor', 'Vlogger', 'Zephyr', 'Kore', 'Charon', 'Puck'] as VoiceOption[]).map(v => (
                    <button 
                      key={v}
                      onClick={() => setVoice(v)}
                      className={`w-full text-left p-4 rounded-2xl border-2 transition-all flex items-center gap-4 ${
                        voice === v ? 'border-indigo-500 bg-indigo-50' : 'border-slate-50 bg-slate-50 hover:bg-white'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs shrink-0 ${voice === v ? 'bg-indigo-600 text-white' : 'bg-white text-slate-300'}`}>
                        {v[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-black flex items-center gap-2">
                          {voiceMetadata[v].label}
                          <span className="text-[8px] font-black bg-white/20 px-1 rounded">{voiceMetadata[v].badge}</span>
                        </div>
                        <div className="text-[9px] truncate text-slate-400 font-medium">{voiceMetadata[v].desc}</div>
                      </div>
                      <div onClick={(e) => { e.stopPropagation(); tryVoicePreview(v); }} className={`p-1.5 rounded-lg transition-all ${isPreviewing === v ? 'text-indigo-600' : 'text-slate-200 hover:text-indigo-600'}`}>
                         {isPreviewing === v ? <div className="w-3 h-3 border-2 border-indigo-600 border-t-transparent animate-spin rounded-full"/> : <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Locale</label>
                  <select value={language} onChange={(e) => setLanguage(e.target.value as AppLanguage)} className="w-full p-4 rounded-2xl bg-slate-100 border-none text-[10px] font-black uppercase tracking-tighter text-slate-700 cursor-pointer shadow-inner">
                    <option value={AppLanguage.HINDI}>Hindi</option>
                    <option value={AppLanguage.ENGLISH}>English</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Age</label>
                  <select value={ageRange} onChange={(e) => setAgeRange(e.target.value as VoiceAgeRange)} className="w-full p-4 rounded-2xl bg-slate-100 border-none text-[10px] font-black uppercase tracking-tighter text-slate-700 cursor-pointer shadow-inner">
                    {Object.values(VoiceAgeRange).map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-50">
                 {mode === AppMode.SCRIPT_TO_SPEECH ? (
                   <button onClick={generateScriptSpeech} disabled={isGeneratingTTS || !scriptText.trim()} className={`w-full py-5 rounded-[2rem] flex flex-col items-center justify-center gap-1.5 transition-all shadow-xl active:scale-95 ${isGeneratingTTS ? 'bg-slate-200 grayscale cursor-not-allowed' : 'bg-indigo-600 text-white shadow-indigo-100'}`}>
                      <div className={`p-1.5 bg-white/10 rounded-full ${isGeneratingTTS ? 'animate-spin' : ''}`}>
                         {isGeneratingTTS ? <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M11 5L6 9H2V15H6L11 19V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>}
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-[0.2em]">{isGeneratingTTS ? 'Processing' : 'Generate'}</span>
                   </button>
                 ) : (
                   <button onClick={toggleRecording} className={`w-full py-5 rounded-[2rem] flex flex-col items-center justify-center gap-1.5 transition-all shadow-xl active:scale-95 ${isActive ? 'bg-red-500 text-white shadow-red-100' : 'bg-slate-900 text-white shadow-slate-100'}`}>
                      <div className={`p-1.5 bg-white/10 rounded-full ${isActive ? 'animate-pulse' : ''}`}>
                         {isActive ? <rect x="6" y="6" width="12" height="12" rx="2" className="fill-white" /> : <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>}
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-[0.2em]">{isActive ? 'Live' : 'Start Engine'}</span>
                   </button>
                 )}
              </div>
            </div>
          </div>

          <div className="bg-slate-900 p-6 rounded-[2.5rem] shadow-2xl border border-slate-800">
             <Visualizer analyser={analyserRef.current} isActive={isActive || isRecordingClone} />
          </div>
        </div>

        {/* Center Workbench */}
        <div className="lg:col-span-6">
          <div className="bg-white rounded-[3.5rem] shadow-2xl border border-white flex flex-col h-[750px] overflow-hidden relative">
            {mode === AppMode.SCRIPT_TO_SPEECH ? (
              <div className="flex flex-col h-full flex-1">
                <div className="px-12 py-10 border-b border-slate-50 flex justify-between items-center bg-white">
                  <div>
                    <h2 className="text-3xl font-black text-slate-800 tracking-tighter">Script Lab</h2>
                    <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">Advanced Synthesis Output</p>
                  </div>
                  <div className="flex gap-4">
                     {lastGeneratedAudioBlob && (
                        <button onClick={() => {
                          const url = URL.createObjectURL(lastGeneratedAudioBlob);
                          const a = document.createElement('a');
                          a.href = url; a.download = 'nsclarynx_synth.wav';
                          a.click();
                        }} className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl hover:bg-emerald-100 transition-all">
                           <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        </button>
                     )}
                     <button onClick={() => setScriptText('')} className="p-3 text-slate-300 hover:text-red-500 transition-all"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                  </div>
                </div>
                <div className="flex-1 p-10">
                  <textarea 
                    value={scriptText}
                    onChange={(e) => setScriptText(e.target.value)}
                    placeholder="Enter script text for vocal synthesis..."
                    className={`w-full h-full p-10 text-3xl font-black text-slate-800 leading-tight bg-slate-50/50 border-none rounded-[3rem] focus:bg-white focus:ring-8 focus:ring-indigo-50 outline-none transition-all resize-none placeholder:text-slate-200 ${language === AppLanguage.HINDI ? 'font-devanagari' : ''}`}
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col h-full flex-1">
                <div className="px-12 py-10 border-b border-slate-50 flex justify-between items-center bg-white sticky top-0 z-10">
                  <div>
                    <h2 className="text-3xl font-black text-slate-800 tracking-tighter">Live Session</h2>
                    <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">Real-time Stream Feed</p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-12 space-y-12 flex flex-col-reverse no-scrollbar">
                  {isActive && currentText && (
                    <div className="bg-slate-900 p-10 rounded-[3rem] rounded-bl-none shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
                      <p className="text-white text-3xl leading-tight font-black tracking-tighter">
                        {currentText}
                        <span className="inline-block w-2.5 h-10 ml-4 bg-indigo-500 animate-pulse rounded-full align-middle"></span>
                      </p>
                    </div>
                  )}

                  {history.map((item) => (
                    <div key={item.id} className="group relative bg-slate-50 p-10 rounded-[3rem] transition-all hover:bg-white hover:shadow-2xl border border-transparent hover:border-slate-100">
                      <div className="flex justify-between items-center mb-6">
                        <span className="px-4 py-1.5 bg-white rounded-full text-[10px] font-black text-slate-400 border border-slate-100 uppercase tracking-widest">{item.timestamp.toLocaleTimeString()}</span>
                        <div className="flex items-center gap-4">
                           {copyFeedback === item.id && <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Saved</span>}
                           <button onClick={() => copyToClipboard(item.text, item.id)} className="opacity-0 group-hover:opacity-100 transition-all p-3 text-slate-300 hover:text-indigo-600"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                        </div>
                      </div>
                      <p className={`text-3xl text-slate-800 leading-tight font-black tracking-tighter ${item.text.match(/[\u0900-\u097F]/) ? 'font-devanagari' : ''}`}>{item.text}</p>
                    </div>
                  ))}

                  {history.length === 0 && !isActive && (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-20 py-20">
                      <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                      <h3 className="text-3xl font-black mt-10">SESSION IDLE</h3>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {error && (
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 p-5 bg-red-600 text-white rounded-3xl shadow-2xl flex items-center gap-4 z-50 animate-bounce">
                <span className="font-black text-xs uppercase tracking-widest">{error}</span>
                <button onClick={() => setError(null)} className="p-1 hover:bg-white/20 rounded-lg"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
              </div>
            )}
          </div>
        </div>

        {/* Right Studio Panel */}
        <div className="lg:col-span-3 space-y-6">
           <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100 flex flex-col h-full">
              <h2 className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.3em] mb-8">Studio Tools</h2>
              
              <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 mb-8">
                 <div className="flex justify-between items-center mb-6">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Clone Engine</span>
                    {clonedVoiceBase64 && <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>}
                 </div>
                 <div className="space-y-3">
                    <button onClick={recordCloneVoice} disabled={isRecordingClone} className={`w-full py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${isRecordingClone ? 'bg-red-500 text-white' : 'bg-white text-indigo-600 border border-indigo-100 hover:shadow-lg active:scale-95'}`}>
                      {isRecordingClone ? `REC ${cloneTimeLeft}S` : 'Record Clip'}
                    </button>
                    <button onClick={() => fileInputRef.current?.click()} className="w-full py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest bg-white text-slate-500 border border-slate-100 hover:border-indigo-300">Upload Wav</button>
                    <input type="file" ref={fileInputRef} className="hidden" accept="audio/*" onChange={handleFileUpload} />
                 </div>
                 {clonedVoiceBase64 && <p className="text-[8px] font-black text-indigo-400 uppercase mt-4 text-center tracking-[0.2em]">Voice DNA Pattern Locked</p>}
              </div>

              <div className="space-y-4">
                 <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Synthesis Tuning</label>
                 <div className="space-y-6 px-2">
                    <div className="space-y-3">
                       <div className="flex justify-between text-[9px] font-black text-slate-400 uppercase">
                          <span>Pitch</span>
                          <span className="text-indigo-600">{vocalPitch.toFixed(1)}x</span>
                       </div>
                       <input type="range" min="0.5" max="1.5" step="0.1" value={vocalPitch} onChange={(e) => setVocalPitch(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
                    </div>
                    <div className="space-y-3">
                       <div className="flex justify-between text-[9px] font-black text-slate-400 uppercase">
                          <span>Speed</span>
                          <span className="text-indigo-600">{vocalSpeed.toFixed(1)}x</span>
                       </div>
                       <input type="range" min="0.5" max="2.0" step="0.1" value={vocalSpeed} onChange={(e) => setVocalSpeed(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
                    </div>
                 </div>
              </div>

              <div className="mt-auto pt-10 border-t border-slate-50">
                 <div className="bg-indigo-600 p-6 rounded-[2rem] text-white shadow-xl shadow-indigo-100">
                    <h4 className="text-[10px] font-black uppercase tracking-widest mb-2">Power Mode</h4>
                    <p className="text-[10px] opacity-70 leading-relaxed font-bold">24kHz PCM High-Fidelity transmission is active for current session.</p>
                 </div>
              </div>
           </div>
        </div>
      </main>

      <footer className="w-full max-w-[1600px] px-8 py-10 text-center border-t border-slate-200 mt-10">
         <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.4em]">NSCLARYNX V2.8.5 • STUDIO ENGINE • POWERED BY GEMINI AUDIO</p>
            <div className="flex gap-8">
               <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-indigo-300"></div> HI-FI SYNTH</span>
               <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-indigo-300"></div> CLONE LAB</span>
            </div>
         </div>
      </footer>
    </div>
  );
};

export default App;
