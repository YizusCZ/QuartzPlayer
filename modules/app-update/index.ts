import { requireOptionalNativeModule } from 'expo-modules-core';

type AppUpdateNative = {
  installed(): { version: string; code: number };
  canInstall(): boolean;
  openInstallPermission(): void;
  install(path: string): void;
  restart(): void;
};

/** Android only (modules/app-update); null elsewhere or in an older build. */
export const AppUpdateModule = requireOptionalNativeModule<AppUpdateNative>('AppUpdate');
