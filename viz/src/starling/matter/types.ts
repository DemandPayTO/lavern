// Shared row/data shapes for the Starling matter workspace (extracted from
// MatterDetailView.tsx). These are the presentational data shapes; richer
// domain types come from ./hooks/useStarlingApi and ./shared.

export interface Issue {
  id: string;
  title: string;
  strength: 'strong' | 'moderate';
  description: string;
  descriptionBold: string[];
  sources: { label: string; type: 'verified' | 'statute' | 'web' | 'ai' }[];
}

export interface DocItem {
  id: string;
  name: string;
  meta: string;
  group: 'uploaded' | 'generated';
  actions: { label: string; variant: 'default' | 'gen' }[];
}

export interface DraftType {
  id: string;
  title: string;
  description: string;
  cost: string;
  section: string;
  recommended?: boolean;
  alreadyDrafted?: boolean;
}

export interface TimelineEvent {
  id: string;
  date: string;
  title: string;
  subtitle: string;
  isCurrent?: boolean;
}
