import { describe, expect, it } from 'vitest';

import { acceptInvitationSchema, inviteStaffSchema } from './staff-invitation';

describe('inviteStaffSchema', () => {
  it('normaliza o e-mail e remove grants repetidos; grants é opcional', () => {
    const parsed = inviteStaffSchema.parse({
      email: '  Nova@Example.COM ',
      grants: ['course.edit', 'course.edit', 'help.edit'],
    });
    expect(parsed).toEqual({ email: 'nova@example.com', grants: ['course.edit', 'help.edit'] });
    expect(inviteStaffSchema.parse({ email: 'a@b.co' }).grants).toEqual([]);
  });

  it('recusa capability exclusiva do Admin, inexistente, papel no corpo e campo extra', () => {
    for (const grants of [['staff.manage'], ['course.create'], ['inventada']]) {
      expect(inviteStaffSchema.safeParse({ email: 'a@b.co', grants }).success).toBe(false);
    }
    expect(inviteStaffSchema.safeParse({ email: 'a@b.co', role: 'admin' }).success).toBe(false);
    expect(inviteStaffSchema.safeParse({ email: 'sem-arroba' }).success).toBe(false);
  });
});

describe('acceptInvitationSchema', () => {
  it('exige token de tamanho plausível e nada além dele', () => {
    expect(acceptInvitationSchema.safeParse({ token: 'x'.repeat(43) }).success).toBe(true);
    expect(acceptInvitationSchema.safeParse({ token: 'curto' }).success).toBe(false);
    expect(acceptInvitationSchema.safeParse({ token: 'x'.repeat(300) }).success).toBe(false);
    expect(
      acceptInvitationSchema.safeParse({ token: 'x'.repeat(43), email: 'a@b.co' }).success,
    ).toBe(false);
  });
});
