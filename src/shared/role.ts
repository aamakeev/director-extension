import type { TV1ExtContext, TV1ExtUser } from '@stripchatdev/ext-helper';

export type DirectorRole = 'model' | 'viewer' | 'guest' | 'unknown';

export const resolveRole = (context: TV1ExtContext | undefined): DirectorRole => {
  const user = context?.user;
  if (!user) return 'unknown';
  if (user.isGuest) return 'guest';
  if (user.isModel) return 'model';
  return 'viewer';
};

export const userIdString = (user: TV1ExtUser | undefined): string => {
  if (!user || user.isGuest) return '';
  return String(user.id);
};

/** Local identity for whisper toasts / self.allocations matching (guests have no numeric id). */
export const whisperSelfId = (user: TV1ExtUser | undefined): string => {
  if (!user) return '';
  if (user.isGuest) {
    return typeof user.guestHash === 'string' ? user.guestHash : '';
  }
  return String(user.id);
};

export const usernameString = (user: TV1ExtUser | undefined): string => {
  if (!user) return 'viewer';
  if (user.isGuest) return 'Guest';
  return String(user.username || 'viewer');
};
