
export enum AppLanguage {
  HINDI = 'hi-IN',
  ENGLISH = 'en-US'
}

export enum AppMode {
  TRANSCRIBE = 'transcribe',
  TRANSLATE = 'translate',
  SCRIPT_TO_SPEECH = 'script_to_speech'
}

export type VoiceOption = 
  | 'Zephyr' 
  | 'Puck' 
  | 'Charon' 
  | 'Kore' 
  | 'Nitin' 
  | 'Clone'
  | 'Narrator'
  | 'Anchor'
  | 'Vlogger';

export enum VoiceAgeRange {
  YOUTH = 'Youthful',
  ADULT = 'Adult',
  ELDER = 'Elderly'
}

export type VoiceStyle = 
  | 'Standard' 
  | 'Formal' 
  | 'Expressive' 
  | 'Conversational' 
  | 'Gentle' 
  | 'Urgent';

export interface TranscriptionItem {
  id: string;
  text: string;
  timestamp: Date;
  sender: 'user' | 'model';
  language?: string;
}
