import { motion } from 'framer-motion';
import type { WizardStep } from './useWizardState';

const STEPS = [
  { num: 1, label: 'identity' },
  { num: 2, label: 'details' },
  { num: 3, label: 'env_data' },
  { num: 4, label: 'tokenomics' },
  { num: 5, label: 'review' },
];

interface WizardStepperProps {
  currentStep: WizardStep;
  onStepClick: (step: WizardStep) => void;
  completedSteps: Set<number>;
  lockedBefore?: number;
}

export function WizardStepper({ currentStep, onStepClick, completedSteps, lockedBefore }: WizardStepperProps) {
  return (
    <div className="flex items-center justify-between mb-8 px-2">
      {STEPS.map((step, idx) => {
        const stepIndex = idx as WizardStep;
        const isActive = currentStep === stepIndex;
        const isCompleted = completedSteps.has(stepIndex);
        const isLocked = lockedBefore !== undefined && idx >= lockedBefore && !isCompleted;
        const isFuture = !isActive && !isCompleted;

        return (
          <div key={step.num} className="flex items-center flex-1 last:flex-none">
            {/* Step circle */}
            <button
              onClick={() => !isLocked && onStepClick(stepIndex)}
              className={`relative flex flex-col items-center gap-1.5 group ${isLocked ? 'cursor-not-allowed opacity-40' : ''}`}
              disabled={isLocked}
            >
              <motion.div
                animate={{
                  scale: isActive ? 1.1 : 1,
                  borderColor: isActive
                    ? 'var(--accent)'
                    : isCompleted
                    ? 'var(--success)'
                    : 'var(--border)',
                }}
                className="w-8 h-8 rounded-full flex items-center justify-center border-2 transition-colors"
                style={{
                  background: isCompleted
                    ? 'var(--success)'
                    : isActive
                    ? 'var(--accent)'
                    : 'var(--bg-secondary)',
                }}
              >
                {isCompleted ? (
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span
                    className="text-xs font-mono font-bold"
                    style={{
                      color: isActive ? 'white' : 'var(--text-muted)',
                    }}
                  >
                    {step.num}
                  </span>
                )}

                {/* Active pulse ring */}
                {isActive && (
                  <motion.div
                    className="absolute inset-0 rounded-full"
                    style={{ border: '2px solid var(--accent)' }}
                    animate={{ scale: [1, 1.4, 1.4], opacity: [0.6, 0, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                )}
              </motion.div>

              <span
                className="text-[10px] font-mono transition-colors"
                style={{
                  color: isActive
                    ? 'var(--accent)'
                    : isFuture
                    ? 'var(--text-muted)'
                    : 'var(--text-secondary)',
                }}
              >
                {step.label}
              </span>
            </button>

            {/* Connector line */}
            {idx < STEPS.length - 1 && (
              <div className="flex-1 mx-2 mt-[-18px]">
                <div
                  className="h-px w-full"
                  style={{
                    background: completedSteps.has(stepIndex)
                      ? 'var(--success)'
                      : 'var(--border)',
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
