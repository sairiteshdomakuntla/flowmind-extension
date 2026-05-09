import type { UserProfile } from '../types';
import { getUserProfile, saveUserProfile } from '../memory/storage';

export const EMPTY_PROFILE: UserProfile = {
  name: '',
  email: '',
  phone: '',
  linkedin_url: '',
  github_url: '',
  portfolio_url: '',
  resume_text: '',
  writing_style: '',
  custom_instructions: '',
};

export async function loadProfile(): Promise<UserProfile> {
  const stored = await getUserProfile();
  return stored ?? EMPTY_PROFILE;
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await saveUserProfile(profile);
}

export async function getProfileAsContext(): Promise<string> {
  const profile = await loadProfile();
  const lines: string[] = [];

  if (profile.name) lines.push(`Name: ${profile.name}`);
  if (profile.email) lines.push(`Email: ${profile.email}`);
  if (profile.phone) lines.push(`Phone: ${profile.phone}`);
  if (profile.linkedin_url) lines.push(`LinkedIn: ${profile.linkedin_url}`);
  if (profile.github_url) lines.push(`GitHub: ${profile.github_url}`);
  if (profile.portfolio_url) lines.push(`Portfolio: ${profile.portfolio_url}`);
  if (profile.resume_text) lines.push(`\nResume:\n${profile.resume_text}`);
  if (profile.writing_style) lines.push(`\nWriting style: ${profile.writing_style}`);
  if (profile.custom_instructions) lines.push(`\nCustom instructions: ${profile.custom_instructions}`);

  if (lines.length === 0) return 'No user profile data available.';
  return `User Profile:\n${lines.join('\n')}`;
}
