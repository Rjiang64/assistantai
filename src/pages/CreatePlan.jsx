import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVoiceInput } from '../lib/speech.js'
import { generatePlan } from '../lib/api.js'
import { todayISODate } from '../lib/time.js'
import { SAMPLE_TRANSCRIPT } from '../lib/sampleTranscript.js'

export default function CreatePlan() {
  const navigate = useNavigate()
  const {
    transcript,
    setTranscript,
    isListening,
    isSupported,
    error: voiceError,
    start,
    stop,
    reset,
  } = useVoiceInput()

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [usedVoice, setUsedVoice] = useState(false)

  function handleMicClick() {
    if (isListening) {
      stop()
    } else {
      setUsedVoice(true)
      start()
    }
  }

  function handleUseSample() {
    reset()
    setTranscript(SAMPLE_TRANSCRIPT)
    setUsedVoice(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!transcript.trim()) {
      setSubmitError('Say or type what you need to get done today first.')
      return
    }
    setSubmitError(null)
    setSubmitting(true)
    try {
      const result = await generatePlan({
        transcript: transcript.trim(),
        inputSource: usedVoice ? 'voice' : 'text',
        planDate: todayISODate(),
      })
      navigate(`/plan/${result.plan.id}`)
    } catch (err) {
      setSubmitError(err.message || 'Something went wrong analyzing your day.')
      setSubmitting(false)
    }
  }

  if (submitting) {
    return (
      <div className="analyzing-state text-center py-5">
        <div className="spinner-border text-primary mb-3" role="status">
          <span className="visually-hidden">Analyzing...</span>
        </div>
        <h2 className="h5 mb-1">Analyzing your day...</h2>
        <p className="text-secondary mb-0">
          Extracting tasks, checking for conflicts, and building your schedule.
        </p>
      </div>
    )
  }

  return (
    <div className="create-plan-page">
      <div className="mb-4">
        <h1 className="h3 mb-1">Brain dump your day</h1>
        <p className="text-secondary mb-0">
          Say everything you need to get done. AssistantAI will figure out the
          rest.
        </p>
      </div>

      <div className="mic-panel text-center mb-4">
        <button
          type="button"
          onClick={handleMicClick}
          className={`mic-button ${isListening ? 'listening' : ''}`}
          aria-pressed={isListening}
          aria-label={isListening ? 'Stop recording' : 'Start recording'}
        >
          <MicIcon />
        </button>
        <p className="mic-status mt-3 mb-0">
          {isListening
            ? 'Listening... tap to stop'
            : isSupported
              ? 'Tap to speak your day'
              : 'Voice not supported in this browser — use the text box below'}
        </p>
        {voiceError && <p className="text-danger small mt-2 mb-0">{voiceError}</p>}
      </div>

      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <div className="d-flex justify-content-between align-items-center mb-1">
            <label className="form-label mb-0" htmlFor="transcript">
              Transcript
            </label>
            <button
              type="button"
              className="btn btn-link btn-sm p-0"
              onClick={handleUseSample}
            >
              Use example
            </button>
          </div>
          <textarea
            id="transcript"
            className="form-control"
            rows={7}
            placeholder="I have class from 9 to 11. I need to finish my SQL assignment which should take about two hours. I have work from 3 until 11..."
            value={transcript}
            onChange={(e) => {
              setUsedVoice(false)
              setTranscript(e.target.value)
            }}
          />
        </div>

        {submitError && <div className="alert alert-danger py-2 small">{submitError}</div>}

        <button type="submit" className="btn btn-primary btn-lg w-100" disabled={submitting}>
          Plan my day
        </button>
      </form>
    </div>
  )
}

function MicIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19 11a7 7 0 0 1-14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
