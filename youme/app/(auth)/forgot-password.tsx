/**
 * Écran Mot de Passe Oublié
 */
import React, { useMemo } from 'react';
import { themedAlert } from '@presentation/components/common/ThemedAlert';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { router } from 'expo-router';
import { TextInput, Button, HelperText } from 'react-native-paper';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { forgotPasswordSchema, type ForgotPasswordFormData } from '../../src/shared/validators/authValidators';
import { useYoumeColors, YoumeColors, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../src/shared/constants/theme';
import { useAuth } from '../../src/presentation/hooks/useAuth';

export default function ForgotPasswordScreen() {
  const { sendPasswordReset, isLoading } = useAuth();
  const colors = useYoumeColors();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const { control, handleSubmit, formState: { errors } } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    try {
      await sendPasswordReset(data.email);
      themedAlert.alert(
        'Email envoyé',
        `Un email de réinitialisation a été envoyé à ${data.email}. Vérifiez votre boîte mail.`,
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (error: any) {
      themedAlert.alert('Erreur', error.message);
    }
  };

  return (
    <View style={styles.container}>
      <Animated.View entering={FadeInDown.springify()} style={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>

        <View style={styles.iconContainer}>
          <Ionicons name="lock-open-outline" size={56} color={colors.primary} />
        </View>

        <Text style={styles.title}>Mot de passe oublié ?</Text>
        <Text style={styles.subtitle}>
          Entrez votre email. Nous vous enverrons un lien pour réinitialiser votre mot de passe.
        </Text>

        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              label="Adresse email"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              keyboardType="email-address"
              autoCapitalize="none"
              mode="outlined"
              style={styles.input}
              outlineStyle={styles.inputOutline}
              textColor={colors.textPrimary}
              left={<TextInput.Icon icon="email-outline" color={colors.textSecondary} />}
              error={!!errors.email}
            />
          )}
        />
        {errors.email && <HelperText type="error">{errors.email.message}</HelperText>}

        <Button
          mode="contained"
          onPress={handleSubmit(onSubmit)}
          loading={isLoading}
          disabled={isLoading}
          style={styles.button}
          contentStyle={styles.buttonContent}
          buttonColor={colors.primary}
        >
          Envoyer le lien
        </Button>
      </Animated.View>
    </View>
  );
}

function getStyles(colors: YoumeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, justifyContent: 'center' },
    content: { paddingHorizontal: SPACING.xl, gap: SPACING.md },
    backButton: { alignSelf: 'flex-start', marginBottom: SPACING.sm },
    iconContainer: {
      alignSelf: 'center',
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: `${colors.primary}22`,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: SPACING.md,
    },
    title: { fontSize: TYPOGRAPHY.size.xxl, fontWeight: '700', color: colors.textPrimary },
    subtitle: { fontSize: TYPOGRAPHY.size.md, color: colors.textSecondary, lineHeight: 22 },
    input: { backgroundColor: colors.inputBackground },
    inputOutline: { borderColor: colors.divider, borderRadius: BORDER_RADIUS.md },
    button: { borderRadius: BORDER_RADIUS.md },
    buttonContent: { height: 50 },
  });
}
