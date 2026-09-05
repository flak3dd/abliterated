export type WebsiteSection = 'hero' | 'demo' | 'features' | 'walkthrough' | 'pricing' | 'faq' | 'download';
export type WebsiteFocus = { section: WebsiteSection; nonce: number };
export type BillingCycle = 'monthly' | 'yearly';
export type PlanId = 'free' | 'pro' | 'team';

/** Marketing site is not mounted in the IDE shell. */
export function WebsiteScreen() {
  return null;
}
