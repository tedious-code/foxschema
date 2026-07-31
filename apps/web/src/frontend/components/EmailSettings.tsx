import React from 'react';
import type { AppInfo } from '../api/setupApi';

/**
 * Encryption-key binding summary in Settings → Security (read-only).
 */
export const EmailSettings: React.FC<{ info: AppInfo; onUpdated: (info: AppInfo) => void }> = ({
  info,
  onUpdated: _onUpdated,
}) => {
  return (
    <p className="text-slate-300">
      {info.security.emailBound ? (
        <>
          Encryption key bound to <span className="font-mono text-slate-200">{info.security.boundEmail}</span>{' '}
          and held in the OS keychain — a copied database can't be decrypted elsewhere.
        </>
      ) : (
        <>Encryption key stored on this install (legacy key scheme).</>
      )}
    </p>
  );
};
