/**
 * ThemedAlert — Boîtes de dialogue personnalisées (remplace Alert.alert natif).
 * L'hôte <ThemedAlertHost /> doit être monté une seule fois, à la racine,
 * à l'intérieur du PaperProvider (voir app/_layout.tsx).
 */
import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Modal, Portal, Text, Button } from 'react-native-paper';
import { YOUME_COLORS, SPACING, BORDER_RADIUS, TYPOGRAPHY } from '@shared/constants/theme';

export type ThemedAlertButton = {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

type AlertConfig = {
  title: string;
  message?: string;
  buttons?: ThemedAlertButton[];
};

let showHandler: ((config: AlertConfig) => void) | null = null;

export const themedAlert = {
  alert(title: string, message?: string, buttons?: ThemedAlertButton[]) {
    if (showHandler) {
      showHandler({ title, message, buttons });
    } else if (__DEV__) {
      console.warn('ThemedAlertHost non monté — alerte ignorée :', title);
    }
  },
};

export function ThemedAlertHost() {
  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState<AlertConfig | null>(null);

  useEffect(() => {
    showHandler = (next) => {
      setConfig(next);
      setVisible(true);
    };
    return () => {
      showHandler = null;
    };
  }, []);

  const dismiss = useCallback(() => setVisible(false), []);

  const buttons: ThemedAlertButton[] =
    config?.buttons && config.buttons.length > 0
      ? config.buttons
      : [{ text: 'OK', style: 'default' }];

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={dismiss}
        contentContainerStyle={styles.modal}
      >
        <View style={styles.card}>
          {!!config?.title && <Text style={styles.title}>{config.title}</Text>}
          {!!config?.message && <Text style={styles.message}>{config.message}</Text>}
          <View style={styles.buttonRow}>
            {buttons.map((b, i) => (
              <Button
                key={`${b.text}-${i}`}
                onPress={() => {
                  dismiss();
                  b.onPress?.();
                }}
                textColor={
                  b.style === 'destructive'
                    ? YOUME_COLORS.error
                    : b.style === 'cancel'
                      ? '#7A6A55'
                      : YOUME_COLORS.primaryDark
                }
                style={styles.button}
                labelStyle={styles.buttonLabel}
                compact
              >
                {b.text}
              </Button>
            ))}
          </View>
        </View>
      </Modal>
    </Portal>
  );
}

// ThemedAlert uses a fixed white card design — intentionally not theme-reactive
// (it's a modal overlay that sits above all content).
const styles = StyleSheet.create({
  modal: {
    marginHorizontal: SPACING.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 2,
    borderColor: YOUME_COLORS.primary,
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.lg,
  },
  title: {
    fontSize: TYPOGRAPHY.size.xl,
    fontWeight: '700',
    color: YOUME_COLORS.primaryDark,
    marginBottom: SPACING.sm,
  },
  message: {
    fontSize: TYPOGRAPHY.size.md,
    color: '#3A2C20',
    lineHeight: 20,
    marginBottom: SPACING.sm,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: SPACING.sm,
  },
  button: {
    marginLeft: SPACING.xs,
  },
  buttonLabel: {
    fontSize: TYPOGRAPHY.size.md,
    fontWeight: '600',
  },
});
