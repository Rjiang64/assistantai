import { useCallback, useEffect, useRef, useState } from 'react'

// Browser-native speech recognition (Web Speech API). This is the MVP
// "voice" implementation per project scope: no Whisper, no external speech
// API. Support is Chrome/Edge/Safari-ish; anywhere it's missing, the caller
// falls back to the text area (see CreatePlan.jsx).

function getRecognitionCtor() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

export function isSpeechRecognitionSupported() {
  return Boolean(getRecognitionCtor())
}

/**
 * useVoiceInput — records speech into a running transcript.
 *
 * Returns:
 *   transcript      - final + interim text recognized so far
 *   isListening     - whether the mic is actively capturing
 *   isSupported     - whether the browser exposes SpeechRecognition
 *   error           - last error message, if any
 *   start()         - begin listening (appends to existing transcript)
 *   stop()          - stop listening
 *   reset()         - clear the transcript
 *   setTranscript() - directly overwrite the transcript (for manual edits)
 */
export function useVoiceInput() {
  const [transcript, setTranscript] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState(null)
  const recognitionRef = useRef(null)
  const baseTranscriptRef = useRef('') // committed text before this listening session

  const isSupported = isSpeechRecognitionSupported()

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop?.()
    }
  }, [])

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      setError('Speech recognition is not supported in this browser. Use the text box instead.')
      return
    }

    setError(null)
    baseTranscriptRef.current = transcript ? `${transcript} ` : ''

    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      let finalText = ''
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalText += result[0].transcript
        } else {
          interimText += result[0].transcript
        }
      }
      if (finalText) {
        baseTranscriptRef.current = `${baseTranscriptRef.current}${finalText} `
      }
      setTranscript(`${baseTranscriptRef.current}${interimText}`.trim())
    }

    recognition.onerror = (event) => {
      if (event.error === 'no-speech') return
      setError(`Microphone error: ${event.error}`)
      setIsListening(false)
    }

    recognition.onend = () => {
      setIsListening(false)
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }, [transcript])

  const stop = useCallback(() => {
    recognitionRef.current?.stop?.()
    setIsListening(false)
  }, [])

  const reset = useCallback(() => {
    baseTranscriptRef.current = ''
    setTranscript('')
    setError(null)
  }, [])

  return {
    transcript,
    setTranscript,
    isListening,
    isSupported,
    error,
    start,
    stop,
    reset,
  }
}
