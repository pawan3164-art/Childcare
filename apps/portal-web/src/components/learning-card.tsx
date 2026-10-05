import { Badge } from '@/components/ui/badge';
import { PhotoGrid } from '@/components/child-timeline';
import type { LearningRecordView } from '@/lib/types';

type Learning = Pick<LearningRecordView, 'title' | 'observation' | 'interpretation' | 'outcomes' | 'nextSteps' | 'children' | 'media'>;

/** A published learning story or observation as families see it (feed and portfolio). */
export function LearningCard({ record }: { record: Learning }) {
  return (
    <div className="space-y-2">
      <p className="font-semibold text-foreground">{record.title}</p>
      {record.children.length > 1 && <p className="text-xs text-muted">With {record.children.map((c) => c.firstName).join(', ')}</p>}
      <p className="whitespace-pre-wrap text-sm text-foreground">{record.observation}</p>
      {record.interpretation && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">What it tells us</p>
          <p className="whitespace-pre-wrap text-sm text-foreground">{record.interpretation}</p>
        </div>
      )}
      {record.media.length > 0 && <PhotoGrid media={record.media} />}
      {record.outcomes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {record.outcomes.map((o) => (
            <Badge key={o.code} tone="primary" title={`${o.outcomeTitle}: ${o.label}`}>
              {o.code} {o.label.length > 48 ? `${o.label.slice(0, 46)}…` : o.label}
            </Badge>
          ))}
        </div>
      )}
      {record.nextSteps && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Next steps</p>
          <p className="whitespace-pre-wrap text-sm text-foreground">{record.nextSteps}</p>
        </div>
      )}
    </div>
  );
}
