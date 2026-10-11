import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { dayHeading, groupMenuByDay, mealLabel, type MenuEntry } from '@/lib/calendar';
import { spacing } from '@/lib/theme';
import { Button, Card, EmptyState, Screen } from '@/components/ui';
import { requestStyles as s } from '@/components/request-ui';
import { useBrand } from '@/lib/brand-context';

/** This week's menu, or next week's. Allergen notes are shown with each meal. */
export default function MenuScreen() {
  const brand = useBrand();
  const [next, setNext] = useState(false);
  // Without dates the server returns the current Monday to Sunday week; next week is the following 7 days.
  const menu = useLoad(
    () => api.get<MenuEntry[]>(next ? `/menus?from=${startOfNextWeek()}&to=${endOfNextWeek()}` : '/menus'),
    next ? 'next' : 'this',
    'Could not load the menu',
  );

  if (menu.error) {
    return (
      <Screen>
        <Text style={s.error}>{menu.error}</Text>
      </Screen>
    );
  }
  if (!menu.data) {
    return (
      <Screen>
        <ActivityIndicator color={brand.primary} />
      </Screen>
    );
  }
  const groups = groupMenuByDay(menu.data);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button title="This week" variant={next ? 'secondary' : 'primary'} onPress={() => setNext(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Next week" variant={next ? 'primary' : 'secondary'} onPress={() => setNext(true)} />
          </View>
        </View>
        {groups.length === 0 ? (
          <EmptyState title="No menu yet" description="The centre has not published a menu for this week." />
        ) : (
          groups.map((g) => (
            <Card key={g.date} style={{ gap: spacing.sm }}>
              <Text style={s.section}>{dayHeading(g.date)}</Text>
              {g.items.map((i) => (
                <View key={i.id} style={{ gap: 2 }}>
                  <Text style={s.muted}>{mealLabel(i.meal)}</Text>
                  <Text style={s.section}>{i.description}</Text>
                  {i.allergenNotes && <Text style={s.muted}>Allergens: {i.allergenNotes}</Text>}
                </View>
              ))}
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

/** Monday of next week, from the device clock (families and centre are in the same part of Australia). */
function startOfNextWeek(): string {
  const d = new Date();
  const fromMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - fromMonday + 7);
  return localIso(d);
}

function endOfNextWeek(): string {
  const d = new Date(`${startOfNextWeek()}T00:00:00`);
  d.setDate(d.getDate() + 6);
  return localIso(d);
}

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
