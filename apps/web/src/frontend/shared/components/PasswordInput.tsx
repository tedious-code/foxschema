/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Password field with press-and-hold eye icon to temporarily reveal the value.
 */
import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  'data-testid'?: string;
};

export const PasswordInput: React.FC<Props> = ({ className = '', 'data-testid': testId, ...props }) => {
  const [visible, setVisible] = useState(false);

  const reveal = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setVisible(true);
  };

  const hide = () => setVisible(false);

  return (
    <div className="relative">
      <input
        {...props}
        data-testid={testId}
        type={visible ? 'text' : 'password'}
        className={`${className} pr-9`.trim()}
      />
      <button
        type="button"
        tabIndex={-1}
        data-testid={testId ? `${testId}-reveal` : 'password-reveal'}
        aria-label="Hold to show password"
        title="Hold to show password"
        onPointerDown={reveal}
        onPointerUp={hide}
        onPointerCancel={hide}
        onLostPointerCapture={hide}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-500 hover:text-slate-200 select-none touch-none"
      >
        {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
};
