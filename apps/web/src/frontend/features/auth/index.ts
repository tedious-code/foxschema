/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The auth feature's public surface.
 *
 * Everything else under this folder is internal, so the layout can change
 * without touching a consumer. These are the symbols other parts of the app
 * actually import today — derived from usage, not guessed, so the surface
 * starts as small as it truly is.
 */
export { fetchAppInfo } from './api/setupApi';
export type { AppInfo } from './api/setupApi';
export { AuthPage } from './components/AuthPage';
export { OnboardingWizard } from './components/OnboardingWizard';
