import { useEffect, useMemo, useRef, useState } from 'react';

type QuizStatus = 'ready' | 'countdown' | 'playing' | 'paused' | 'finished';

type Question = {
  id: number;
  stringName: string;
  stringIndex: number;
  fret: number;
  answer: string;
};

type NotePosition = {
  stringName: string;
  stringIndex: number;
  fret: number;
  answer: string;
};

type AnswerReview = {
  questionNumber: number;
  stringName: string;
  stringIndex: number;
  fret: number;
  correctAnswer: string;
  selectedAnswer: string | null;
  wasCorrect: boolean;
  timedOut: boolean;
};

type WrongAnswerStat = {
  key: string;
  label: string;
  stringName: string;
  fret: number;
  correctAnswer: string;
  count: number;
};

const NOTE_ORDER = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const STRINGS = ['G', 'D', 'A', 'E'];
const TOTAL_QUESTIONS = 20;
const TIME_OPTIONS = [8, 6, 4] as const;
const DEFAULT_SECONDS_PER_QUESTION = 4;
const COUNTDOWN_SECONDS = 3;
const BETWEEN_QUESTION_PAUSE_MS = 1000;
const MAX_FRET = 12;
const SINGLE_FRET_MARKERS = [3, 5, 7, 9];
const DOUBLE_FRET_MARKERS = [12];
const WRONG_STATS_STORAGE_KEY = 'bass-note-quiz-wrong-answer-stats';

function noteAt(openString: string, fret: number): string {
  const startIndex = NOTE_ORDER.indexOf(openString);
  return NOTE_ORDER[(startIndex + fret) % NOTE_ORDER.length];
}

function formatElapsedTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function buildQuestionPool(selectedNotes: string[]): NotePosition[] {
  const allowedNotes = new Set(selectedNotes);

  return STRINGS.flatMap((stringName, stringIndex) =>
    Array.from({ length: MAX_FRET + 1 }, (_, fret) => {
      const answer = noteAt(stringName, fret);

      return {
        stringName,
        stringIndex,
        fret,
        answer,
      };
    }).filter((position) => allowedNotes.has(position.answer)),
  );
}

function makeQuestion(id: number, selectedNotes: string[], previous?: Question): Question {
  const pool = buildQuestionPool(selectedNotes);
  const fallbackPool = buildQuestionPool(NOTE_ORDER);
  const availablePool = pool.length > 0 ? pool : fallbackPool;

  let position = availablePool[Math.floor(Math.random() * availablePool.length)];

  if (previous && availablePool.length > 1) {
    let attempts = 0;

    while (
      attempts < 20 &&
      previous.stringIndex === position.stringIndex &&
      previous.fret === position.fret
    ) {
      position = availablePool[Math.floor(Math.random() * availablePool.length)];
      attempts += 1;
    }
  }

  return {
    id,
    stringName: position.stringName,
    stringIndex: position.stringIndex,
    fret: position.fret,
    answer: position.answer,
  };
}

function getDefaultSelectedNotes(): string[] {
  return ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
}

function getNoteChoices(answer: string): string[] {
  const choices = new Set<string>([answer]);

  while (choices.size < 6) {
    choices.add(NOTE_ORDER[Math.floor(Math.random() * NOTE_ORDER.length)]);
  }

  return Array.from(choices).sort(() => Math.random() - 0.5);
}

function getScoreLabel(score: number): string {
  if (score === TOTAL_QUESTIONS) return 'Perfect score';
  if (score >= 16) return 'Excellent';
  if (score >= 12) return 'Good progress';
  if (score >= 8) return 'Keep practising';
  return 'Focus on one string at a time';
}

function loadWrongAnswerStats(): WrongAnswerStat[] {
  try {
    const raw = window.localStorage.getItem(WRONG_STATS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WrongAnswerStat[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveWrongAnswerStats(stats: WrongAnswerStat[]) {
  try {
    window.localStorage.setItem(WRONG_STATS_STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Keep quiz usable if storage is unavailable.
  }
}

function mistakeKey(question: Question): string {
  return `${question.stringName}:${question.fret}:${question.answer}`;
}

function mistakeLabel(question: Question): string {
  return `${question.stringName} string · ${question.fret === 0 ? 'open' : `fret ${question.fret}`} · ${question.answer}`;
}

export default function App() {
  const [status, setStatus] = useState<QuizStatus>('ready');
  const [secondsPerQuestion, setSecondsPerQuestion] = useState<number>(DEFAULT_SECONDS_PER_QUESTION);
  const [selectedNotes, setSelectedNotes] = useState<string[]>(() => getDefaultSelectedNotes());
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [question, setQuestion] = useState<Question>(() => makeQuestion(1, getDefaultSelectedNotes()));
  const [choices, setChoices] = useState<string[]>(() => getNoteChoices(question.answer));
  const [score, setScore] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(secondsPerQuestion);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [wasCorrect, setWasCorrect] = useState<boolean | null>(null);
  const [answeredQuestions, setAnsweredQuestions] = useState(0);
  const [answerReview, setAnswerReview] = useState<AnswerReview[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [finalElapsedSeconds, setFinalElapsedSeconds] = useState(0);
  const [wrongStats, setWrongStats] = useState<WrongAnswerStat[]>(() => loadWrongAnswerStats());
  const timerRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);

  const progress = useMemo(() => {
    return Math.round((answeredQuestions / TOTAL_QUESTIONS) * 100);
  }, [answeredQuestions]);

  const topWrongStats = useMemo(() => {
    return [...wrongStats].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 3);
  }, [wrongStats]);

  const selectedQuestionPool = useMemo(() => buildQuestionPool(selectedNotes), [selectedNotes]);
  const canStartQuiz = selectedNotes.length > 0 && selectedQuestionPool.length > 0;

  function toggleSelectedNote(note: string) {
    setSelectedNotes((current) => {
      if (current.includes(note)) {
        return current.filter((item) => item !== note);
      }

      return [...current, note];
    });
  }

  function selectNaturalNotes() {
    setSelectedNotes(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
  }

  function selectAllNotes() {
    setSelectedNotes([...NOTE_ORDER]);
  }

  function clearSelectedNotes() {
    setSelectedNotes([]);
  }

  function clearMainTimer() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function clearCountdownTimer() {
    if (countdownRef.current) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }

  function stopTimers() {
    clearMainTimer();
    clearCountdownTimer();

    if (elapsedTimerRef.current) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }

  function loadNextQuestion(nextNumber: number, previous?: Question) {
    const nextQuestion = makeQuestion(nextNumber, selectedNotes, previous);
    setQuestion(nextQuestion);
    setChoices(getNoteChoices(nextQuestion.answer));
    setSecondsLeft(secondsPerQuestion);
    setSelectedAnswer(null);
    setWasCorrect(null);
  }

  function startQuiz() {
    stopTimers();
    setStatus('countdown');
    setScore(0);
    setAnsweredQuestions(0);
    setAnswerReview([]);
    setElapsedSeconds(0);
    setFinalElapsedSeconds(0);
    setCountdown(COUNTDOWN_SECONDS);
    loadNextQuestion(1);
  }

  function startPlayingAfterCountdown() {
    setStatus('playing');
    setCountdown(COUNTDOWN_SECONDS);
  }

  function finishQuiz() {
    setStatus('finished');
    setSelectedAnswer(null);
    setWasCorrect(null);
    setFinalElapsedSeconds((current) => current || elapsedSeconds);
    stopTimers();
  }

  function updateWrongStats(currentQuestion: Question) {
    setWrongStats((current) => {
      const key = mistakeKey(currentQuestion);
      const existing = current.find((item) => item.key === key);
      let next: WrongAnswerStat[];

      if (existing) {
        next = current.map((item) => item.key === key ? { ...item, count: item.count + 1 } : item);
      } else {
        next = [
          ...current,
          {
            key,
            label: mistakeLabel(currentQuestion),
            stringName: currentQuestion.stringName,
            fret: currentQuestion.fret,
            correctAnswer: currentQuestion.answer,
            count: 1,
          },
        ];
      }

      saveWrongAnswerStats(next);
      return next;
    });
  }

  function recordAnswer(currentQuestion: Question, selected: string | null, timedOut = false) {
    const correct = selected === currentQuestion.answer;

    setAnswerReview((current) => [
      ...current,
      {
        questionNumber: current.length + 1,
        stringName: currentQuestion.stringName,
        stringIndex: currentQuestion.stringIndex,
        fret: currentQuestion.fret,
        correctAnswer: currentQuestion.answer,
        selectedAnswer: selected,
        wasCorrect: correct,
        timedOut,
      },
    ]);

    if (!correct) {
      updateWrongStats(currentQuestion);
    }

    return correct;
  }

  function advanceQuestion(currentQuestion: Question) {
    clearMainTimer();
    setStatus('paused');

    setAnsweredQuestions((current) => {
      const nextAnswered = current + 1;

      if (nextAnswered >= TOTAL_QUESTIONS) {
        window.setTimeout(finishQuiz, BETWEEN_QUESTION_PAUSE_MS);
      } else {
        window.setTimeout(() => {
          loadNextQuestion(nextAnswered + 1, currentQuestion);
          setStatus('playing');
        }, BETWEEN_QUESTION_PAUSE_MS);
      }

      return nextAnswered;
    });
  }

  function answerQuestion(answer: string) {
    if (status !== 'playing' || selectedAnswer) return;

    const correct = recordAnswer(question, answer);
    setSelectedAnswer(answer);
    setWasCorrect(correct);

    if (correct) {
      setScore((current) => current + 1);
    }

    advanceQuestion(question);
  }

  function skipQuestion() {
    if (status !== 'playing' || selectedAnswer) return;
    recordAnswer(question, null, true);
    setSelectedAnswer('__timeout__');
    setWasCorrect(false);
    advanceQuestion(question);
  }

  function resetWrongStats() {
    setWrongStats([]);
    saveWrongAnswerStats([]);
  }

  useEffect(() => {
    if (status !== 'countdown') return;

    clearCountdownTimer();

    countdownRef.current = window.setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          clearCountdownTimer();
          window.setTimeout(startPlayingAfterCountdown, 0);
          return COUNTDOWN_SECONDS;
        }

        return current - 1;
      });
    }, 1000);

    return clearCountdownTimer;
  }, [status]);

  useEffect(() => {
    if (status !== 'playing') return;

    clearMainTimer();

    timerRef.current = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          skipQuestion();
          return secondsPerQuestion;
        }

        return current - 1;
      });
    }, 1000);

    return clearMainTimer;
  }, [status, question.id, selectedAnswer, secondsPerQuestion]);

  useEffect(() => {
    if (status !== 'playing' && status !== 'paused') return;

    if (elapsedTimerRef.current) {
      window.clearInterval(elapsedTimerRef.current);
    }

    elapsedTimerRef.current = window.setInterval(() => {
      setElapsedSeconds((current) => {
        const next = current + 1;
        setFinalElapsedSeconds(next);
        return next;
      });
    }, 1000);

    return () => {
      if (elapsedTimerRef.current) {
        window.clearInterval(elapsedTimerRef.current);
      }
    };
  }, [status]);

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Bass neck trainer</p>
          <h1>Bass Note Pop Quiz</h1>
          <p className="intro">
            Answer 20 quick-fire questions. Each question highlights one fret on the bass neck.
            Choose the correct note name before the timer runs out.
          </p>
        </div>

        <div className="hero-card">
          <span className="hero-number">{score}</span>
          <span className="hero-label">points</span>
        </div>
      </section>

      {status === 'ready' && (
        <section className="panel start-panel">
          <h2>Ready to practise?</h2>
          <p>
            The quiz uses a standard 4-string bass in EADG tuning and asks notes from the open
            string to fret 12. Choose a small set of notes for focused practice, or select all
            notes for a full-neck challenge.
          </p>

          <fieldset className="time-options">
            <legend>Seconds per question</legend>
            <div className="time-option-grid">
              {TIME_OPTIONS.map((seconds) => (
                <label
                  key={seconds}
                  className={`time-option ${secondsPerQuestion === seconds ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="secondsPerQuestion"
                    value={seconds}
                    checked={secondsPerQuestion === seconds}
                    onChange={() => {
                      setSecondsPerQuestion(seconds);
                      setSecondsLeft(seconds);
                    }}
                  />
                  <span>{seconds}s</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="note-options">
            <legend>Notes to include in this run</legend>
            <p>
              Select the note names you want to practise. The quiz will ask only these notes, but
              it will show them in different positions across the bass neck.
            </p>

            <div className="note-option-grid">
              {NOTE_ORDER.map((note) => (
                <label
                  key={note}
                  className={`note-option ${selectedNotes.includes(note) ? 'selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedNotes.includes(note)}
                    onChange={() => toggleSelectedNote(note)}
                  />
                  <span>{note}</span>
                </label>
              ))}
            </div>

            <div className="note-option-actions">
              <button type="button" onClick={selectNaturalNotes}>Natural notes</button>
              <button type="button" onClick={selectAllNotes}>All notes</button>
              <button type="button" onClick={clearSelectedNotes}>Clear</button>
            </div>

            <p className="note-selection-summary">
              {selectedNotes.length === 0
                ? 'Select at least one note to start.'
                : `${selectedNotes.length} note${selectedNotes.length === 1 ? '' : 's'} selected · ${selectedQuestionPool.length} neck position${selectedQuestionPool.length === 1 ? '' : 's'} available`}
            </p>
          </fieldset>

          {topWrongStats.length > 0 && (
            <WrongStatsPanel stats={topWrongStats} onReset={resetWrongStats} compact={true} />
          )}

          <button className="primary-button" onClick={startQuiz} disabled={!canStartQuiz}>
            Start 20-question quiz
          </button>
        </section>
      )}

      {status === 'countdown' && (
        <section className="panel countdown-panel">
          <p className="eyebrow">Get ready</p>
          <h2>{countdown}</h2>
          <p>The first question starts after the countdown.</p>
        </section>
      )}

      {(status === 'playing' || status === 'paused') && (
        <>
          <section className="status-grid">
            <div className="metric">
              <span>Question</span>
              <strong>{answeredQuestions + 1} / {TOTAL_QUESTIONS}</strong>
            </div>
            <div className="metric">
              <span>Time left</span>
              <strong>{status === 'paused' ? 'Pause' : `${secondsLeft}s`}</strong>
            </div>
            <div className="metric">
              <span>Run time</span>
              <strong>{formatElapsedTime(elapsedSeconds)}</strong>
            </div>
          </section>

          <section className="panel quiz-panel">
            <div className="quiz-heading">
              <div>
                <p className="eyebrow">{status === 'paused' ? 'Next question loading' : 'Find this note'}</p>
                <h2>
                  {question.stringName} string · {question.fret === 0 ? 'open' : `fret ${question.fret}`}
                </h2>
              </div>

              <div className={`feedback ${wasCorrect === null ? '' : wasCorrect ? 'correct' : 'wrong'}`}>
                {status === 'paused'
                  ? '1 second pause'
                  : wasCorrect === null
                    ? 'Choose the note'
                    : wasCorrect
                      ? 'Correct'
                      : `Answer: ${question.answer}`}
              </div>
            </div>

            <BassNeck question={question} showAnswerLabel={false} />

            <div className="answers" aria-label="Choose the note name">
              {choices.map((choice) => {
                const isSelected = selectedAnswer === choice;
                const isCorrect = question.answer === choice;

                return (
                  <button
                    key={choice}
                    className={[
                      'answer-button',
                      selectedAnswer && isCorrect ? 'correct-answer' : '',
                      isSelected && !isCorrect ? 'wrong-answer' : '',
                    ].join(' ')}
                    onClick={() => answerQuestion(choice)}
                    disabled={Boolean(selectedAnswer) || status === 'paused'}
                  >
                    {choice}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="progress-track" aria-label="Quiz progress">
            <div className="progress-bar" style={{ width: `${progress}%` }} />
          </div>
        </>
      )}

      {status === 'finished' && (
        <section className="panel final-panel">
          <p className="eyebrow">Final score</p>
          <h2>{score} / {TOTAL_QUESTIONS}</h2>
          <div className="final-metrics">
            <div>
              <span>Final time</span>
              <strong>{formatElapsedTime(finalElapsedSeconds)}</strong>
            </div>
            <div>
              <span>Question speed</span>
              <strong>{formatElapsedTime(Math.round(finalElapsedSeconds / TOTAL_QUESTIONS))} avg</strong>
            </div>
          </div>
          <p className="score-label">{getScoreLabel(score)}</p>
          <p>
            You answered {score} questions correctly. Review the correct answers below, including
            a bass neck diagram for each question.
          </p>
          <button className="primary-button" onClick={startQuiz}>
            Play again
          </button>

          <WrongStatsPanel stats={topWrongStats} onReset={resetWrongStats} />

          <AnswerReviewList answers={answerReview} />
        </section>
      )}
    </main>
  );
}

function BassNeck({
  question,
  showAnswerLabel,
  compact = false,
}: {
  question: { stringName: string; stringIndex: number; fret: number; answer: string };
  showAnswerLabel: boolean;
  compact?: boolean;
}) {
  const frets = Array.from({ length: MAX_FRET + 1 }, (_, fret) => fret);

  return (
    <div className={`neck-wrap ${compact ? 'compact-neck-wrap' : ''}`} aria-label="Bass fretboard diagram">
      <div className={`fret-labels ${compact ? 'compact-fret-labels' : ''}`}>
        <span />
        {frets.map((fret) => (
          <span key={fret}>{fret === 0 ? 'Open' : fret}</span>
        ))}
      </div>

      <div className="neck">
        {STRINGS.map((stringName, stringIndex) => (
          <div className={`string-row ${compact ? 'compact-string-row' : ''}`} key={stringName}>
            <div className="string-name">{stringName}</div>

            {frets.map((fret) => {
              const isTarget = question.stringIndex === stringIndex && question.fret === fret;
              const showMarkerAnchor = stringIndex === 1;
              const isSingleMarker = SINGLE_FRET_MARKERS.includes(fret);
              const isDoubleMarker = DOUBLE_FRET_MARKERS.includes(fret);

              return (
                <div className={`fret-cell ${fret === 0 ? 'open-cell' : ''} ${compact ? 'compact-fret-cell' : ''}`} key={fret}>
                  <span className="string-line" />

                  {showMarkerAnchor && isSingleMarker && (
                    <span className="cell-fret-marker single-cell-marker" aria-hidden="true" />
                  )}

                  {showMarkerAnchor && isDoubleMarker && (
                    <span className="double-cell-marker-wrap" aria-hidden="true">
                      <span className="cell-fret-marker" />
                      <span className="cell-fret-marker" />
                    </span>
                  )}

                  {isTarget && (
                    <span
                      className={`highlighted-fret ${compact ? 'compact-highlighted-fret' : ''}`}
                      aria-label={`Highlighted ${stringName} string fret ${fret}`}
                    >
                      {showAnswerLabel ? question.answer : '?'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function WrongStatsPanel({
  stats,
  onReset,
  compact = false,
}: {
  stats: WrongAnswerStat[];
  onReset: () => void;
  compact?: boolean;
}) {
  if (stats.length === 0) {
    return (
      <div className={`wrong-stats ${compact ? 'wrong-stats-compact' : ''}`}>
        <h3>Most often wrong</h3>
        <p>No wrong-answer history yet.</p>
      </div>
    );
  }

  return (
    <div className={`wrong-stats ${compact ? 'wrong-stats-compact' : ''}`}>
      <div className="wrong-stats-heading">
        <h3>Top 3 most often wrong</h3>
        <button type="button" onClick={onReset}>Reset record</button>
      </div>
      <ol>
        {stats.map((stat) => (
          <li key={stat.key}>
            <strong>{stat.correctAnswer}</strong>
            <span>{stat.stringName} string · {stat.fret === 0 ? 'open' : `fret ${stat.fret}`} · missed {stat.count} time{stat.count === 1 ? '' : 's'}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AnswerReviewList({ answers }: { answers: AnswerReview[] }) {
  return (
    <div className="answer-review">
      <h3>Answer review</h3>
      <div className="answer-review-list">
        {answers.map((answer) => (
          <div
            key={answer.questionNumber}
            className={`review-card ${answer.wasCorrect ? 'review-correct' : 'review-wrong'}`}
          >
            <div className="review-card-header">
              <div>
                <strong>Question {answer.questionNumber}</strong>
                <span>
                  {answer.stringName} string · {answer.fret === 0 ? 'open' : `fret ${answer.fret}`}
                </span>
              </div>
              <div className="review-status">
                {answer.wasCorrect ? 'Correct' : answer.timedOut ? 'Timed out' : 'Incorrect'}
              </div>
            </div>

            <BassNeck
              question={{
                stringName: answer.stringName,
                stringIndex: answer.stringIndex,
                fret: answer.fret,
                answer: answer.correctAnswer,
              }}
              showAnswerLabel={true}
              compact={true}
            />

            <div className="review-answer-grid">
              <div>
                <span>Your answer</span>
                <strong>{answer.timedOut ? 'Timed out' : answer.selectedAnswer ?? 'No answer'}</strong>
              </div>
              <div>
                <span>Correct answer</span>
                <strong>{answer.correctAnswer}</strong>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
