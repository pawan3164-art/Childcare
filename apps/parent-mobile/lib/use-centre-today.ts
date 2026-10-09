import { api } from './api';
import { useLoad } from './use-load';
import type { TimelineResponse } from './types';

/** The centre's local "today" (YYYY-MM-DD) as the server sees it, so day pickers match what the API will accept. */
export function useCentreToday(childId: string) {
  const timeline = useLoad(() => api.get<TimelineResponse>(`/children/${childId}/timeline`), childId, 'Could not reach the centre');
  return { today: timeline.data?.date ?? null, error: timeline.error };
}
