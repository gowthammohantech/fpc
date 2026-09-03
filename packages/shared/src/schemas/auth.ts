import { z } from 'zod';

export const loginRequest = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
export type LoginRequest = z.infer<typeof loginRequest>;

export const refreshRequest = z.object({
  refreshToken: z.string().min(10),
});
export type RefreshRequest = z.infer<typeof refreshRequest>;

export const acceptInviteRequest = z.object({
  token: z.string().min(20, 'Invitation token is missing or malformed'),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .regex(/[a-z]/, 'Must contain a lowercase letter')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/\d/, 'Must contain a digit'),
});
export type AcceptInviteRequest = z.infer<typeof acceptInviteRequest>;

export const changePasswordRequest = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .regex(/[a-z]/, 'Must contain a lowercase letter')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/\d/, 'Must contain a digit'),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequest>;
