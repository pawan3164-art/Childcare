'use client';

import { useCallback, useEffect, useState } from 'react';
import { BedDouble, Crown } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { PageSpinner, ErrorBanner } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Room } from '@/lib/types';

interface RoomStaff {
  userId: string;
  firstName: string;
  lastName: string;
  isLead: boolean;
}

/** Centre admin settings: safe-sleep check interval (OI-20) and room leaders (OI-23). */
export default function SettingsPage() {
  const [interval, setIntervalValue] = useState<string>('');
  const [saved, setSaved] = useState<number | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [staff, setStaff] = useState<Record<string, RoomStaff[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadStaff = useCallback(async (roomList: Room[]) => {
    const entries = await Promise.all(roomList.map(async (r) => [r.id, await api.get<RoomStaff[]>(`/rooms/${r.id}/staff`)] as const));
    setStaff(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    Promise.all([api.get<{ sleepCheckIntervalMinutes: number }>('/centre/settings'), api.get<Room[]>('/rooms')])
      .then(async ([s, r]) => {
        setIntervalValue(String(s.sleepCheckIntervalMinutes));
        setSaved(s.sleepCheckIntervalMinutes);
        setRooms(r);
        await loadStaff(r);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load settings'));
  }, [loadStaff]);

  async function saveInterval() {
    setError(null);
    setMessage(null);
    try {
      const s = await api.patch<{ sleepCheckIntervalMinutes: number }>('/centre/settings', { sleepCheckIntervalMinutes: Number(interval) });
      setSaved(s.sleepCheckIntervalMinutes);
      setMessage(`Sleep checks are now due every ${s.sleepCheckIntervalMinutes} minutes.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Setting not saved');
    }
  }

  async function setLead(roomId: string, userId: string, isLead: boolean) {
    setError(null);
    try {
      await api.put(`/rooms/${roomId}/staff/${userId}/lead`, { isLead });
      if (rooms) await loadStaff(rooms);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Room lead not changed');
    }
  }

  if (!rooms && !error) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Centre settings</h1>
        <p className="text-sm text-muted">Safe-sleep checks and who leads each room.</p>
      </div>
      {error && <ErrorBanner message={error} />}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BedDouble size={18} /> Sleep-check interval
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted">How often a sleeping child must be checked. Follow your state regulator&apos;s requirement and your centre&apos;s safe-sleep policy (5 to 30 minutes).</p>
          <div className="flex items-end gap-3">
            <div className="w-32">
              <Label htmlFor="interval">Minutes</Label>
              <Input id="interval" type="number" min={5} max={30} value={interval} onChange={(e) => setIntervalValue(e.target.value)} />
            </div>
            <Button onClick={saveInterval} disabled={!interval || Number(interval) === saved}>
              Save
            </Button>
          </div>
          {message && <p className="text-sm text-success">{message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown size={18} /> Room leaders
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted">The room leader reviews and publishes the room&apos;s learning stories and observations. They can&apos;t publish their own.</p>
          {rooms?.map((room) => (
            <div key={room.id} className="rounded-lg border border-border p-3">
              <p className="mb-2 font-medium text-foreground">{room.name}</p>
              {(staff[room.id] ?? []).length === 0 ? (
                <p className="text-sm text-muted">No educators assigned.</p>
              ) : (
                <div className="space-y-2">
                  {staff[room.id].map((s) => (
                    <div key={s.userId} className="flex items-center gap-3 text-sm">
                      <span className="flex-1 text-foreground">
                        {s.firstName} {s.lastName}
                      </span>
                      {s.isLead && <Badge tone="primary">Room leader</Badge>}
                      <Button size="sm" variant={s.isLead ? 'ghost' : 'secondary'} onClick={() => setLead(room.id, s.userId, !s.isLead)}>
                        {s.isLead ? 'Remove as leader' : 'Make leader'}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {(staff[room.id] ?? []).length > 0 && !(staff[room.id] ?? []).some((s) => s.isLead) && (
                <p className="mt-2 text-xs text-warning">No leader: this room&apos;s learning stories can&apos;t be published until one is chosen.</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
