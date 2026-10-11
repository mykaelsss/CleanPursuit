import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';

// Reads a message aloud with VoiceOver or TalkBack whenever it changes, such as a new error.
export function useAnnounce(message: string | null | undefined) {
  useEffect(() => {
    if (message) AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
}
