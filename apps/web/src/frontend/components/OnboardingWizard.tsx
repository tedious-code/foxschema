import React, { useState } from 'react';
import { Loader2, ChevronRight, Table2, Eye, FunctionSquare, Code, Database } from 'lucide-react';
import { useAuthStore } from '../store/authStore';

const ROLES = ['Developer', 'DBA', 'Data Engineer', 'Analyst', 'Student', 'Other'];
// Only dialects with a working provider today (DB2). Add more as providers land.
const DATABASES = ['DB2', 'PostgreSQL', 'MySQL'];
const GOALS: { id: string; label: string; icon: React.ReactNode }[] = [
  { id: 'COMPARE_SCHEMAS', label: 'Compare schemas', icon: <Table2 className="w-5 h-5" /> },
  { id: 'GENERATE_SQL', label: 'Generate migration SQL', icon: <Code className="w-5 h-5" /> },
  { id: 'EXPLORE_DATABASE', label: 'Explore a database', icon: <Eye className="w-5 h-5" /> },
  { id: 'CREATE_DOCUMENTATION', label: 'Document a schema', icon: <FunctionSquare className="w-5 h-5" /> },
];

export const OnboardingWizard: React.FC = () => {
  const { completeOnboarding, busy, error } = useAuthStore();
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<string>();
  const [primaryDatabase, setPrimaryDatabase] = useState<string>();
  const [primaryGoal, setPrimaryGoal] = useState<string>();

  const steps = [
    {
      title: 'What best describes you?',
      options: ROLES,
      value: role,
      pick: (v: string) => { setRole(v); setStep(1); },
    },
    {
      title: 'Which database do you use most?',
      options: DATABASES,
      value: primaryDatabase,
      pick: (v: string) => { setPrimaryDatabase(v); setStep(2); },
    },
  ];

  const finish = (goal: string) => {
    setPrimaryGoal(goal);
    completeOnboarding({ role, primaryDatabase, primaryGoal: goal });
  };

  return (
    <div className="h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-4">
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-center gap-2 mb-2 text-slate-500">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`h-1.5 w-10 rounded-full ${i <= step ? 'bg-cyan-500' : 'bg-slate-800'}`} />
          ))}
        </div>
        <p className="text-center text-xs text-slate-500 mb-6">Step {step + 1} of 3</p>

        {step < 2 ? (
          <div>
            <h2 className="text-lg font-bold text-center mb-6">{steps[step].title}</h2>
            <div className="grid grid-cols-2 gap-3">
              {steps[step].options.map((opt) => (
                <button
                  key={opt}
                  onClick={() => steps[step].pick(opt)}
                  className={`flex items-center justify-between px-4 py-3 rounded-lg border text-sm font-semibold transition cursor-pointer ${
                    steps[step].value === opt
                      ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-600 text-slate-200'
                  }`}
                >
                  {opt}
                  <ChevronRight className="w-4 h-4 text-slate-500" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <h2 className="text-lg font-bold text-center mb-6">What would you like to do first?</h2>
            <div className="grid grid-cols-1 gap-3">
              {GOALS.map((g) => (
                <button
                  key={g.id}
                  disabled={busy}
                  onClick={() => finish(g.id)}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg border border-slate-800 bg-slate-900/60 hover:border-cyan-500/40 hover:bg-cyan-500/5 text-sm font-semibold text-slate-200 transition cursor-pointer disabled:opacity-60"
                >
                  <span className="text-cyan-400">{g.icon}</span>
                  {g.label}
                  {busy && primaryGoal === g.id && <Loader2 className="w-4 h-4 animate-spin ml-auto" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {step > 0 && step < 2 && (
          <button onClick={() => setStep(step - 1)} className="mt-6 text-xs text-slate-500 hover:text-slate-300 mx-auto block">
            ← Back
          </button>
        )}
        {error && <p className="mt-4 text-xs text-rose-400 text-center">{error}</p>}

        <div className="flex items-center justify-center gap-1.5 mt-8 text-slate-700">
          <Database className="w-3.5 h-3.5" />
          <span className="text-[10px] uppercase tracking-wider">Fox</span>
        </div>
      </div>
    </div>
  );
};
