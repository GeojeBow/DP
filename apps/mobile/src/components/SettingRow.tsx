import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { spacing, type, usePalette } from '../theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

function Row({ icon, title, detail, right, onPress, last }: {
  icon: IconName;
  title: string;
  detail?: string;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const palette = usePalette();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [
        styles.row,
        { borderColor: palette.border, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}>
        <Ionicons name={icon} size={18} color={palette.brand} />
      </View>
      <View style={styles.text}>
        <Text style={[type.body, { color: palette.text, fontWeight: '600' }]}>{title}</Text>
        {detail ? <Text style={[type.caption, { color: palette.textMuted }]}>{detail}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

/** A settings line that opens another screen. */
export function NavRow(props: { icon: IconName; title: string; detail?: string; value?: string; onPress: () => void; last?: boolean }) {
  const palette = usePalette();
  return (
    <Row
      {...props}
      right={
        <View style={styles.right}>
          {props.value ? <Text style={[type.caption, { color: palette.textMuted }]} numberOfLines={1}>{props.value}</Text> : null}
          <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
        </View>
      }
    />
  );
}

/** A settings line with an on/off switch. */
export function ToggleRow({ value, onChange, ...props }: {
  icon: IconName; title: string; detail?: string; value: boolean; onChange: (on: boolean) => void; last?: boolean;
}) {
  const palette = usePalette();
  return (
    <Row
      {...props}
      onPress={() => onChange(!value)}
      right={
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ true: palette.brand, false: palette.border }}
          thumbColor="#FFFFFF"
          accessibilityLabel={props.title}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, maxWidth: '45%' },
});
