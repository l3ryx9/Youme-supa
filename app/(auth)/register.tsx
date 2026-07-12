/**
 * Écran d'Inscription
 */
import React, { useState, useMemo } from 'react';
import { themedAlert } from '@presentation/components/common/ThemedAlert';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { TextInput, Button, HelperText } from 'react-native-paper';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import {
  registerSchema,
  type RegisterFormData,
} from '../../src/shared/validators/authValidators';
import { useYoumeColors, YoumeColors, SPACING, TYPOGRAPHY, BORDER_RADIUS } from '../../src/shared/constants/theme';
import { useAuth } from '../../src/presentation/hooks/useAuth';
import { PasswordStrengthBar } from '../../src/presentation/components/common/PasswordStrengthBar';

export default function RegisterScreen() {
  const { register: registerUser, isLoading } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const colors = useYoumeColors();
  const styles = useMemo(() => getStyles(colors), [colors]);

  const {
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
      username: '',
      displayName: '',
    },
  });

  const password = watch('password');

  const onSubmit = async (data: RegisterFormData) => {
    try {
      await registerUser(data);
      themedAlert.alert(
        'Compte créé !',
        'Un email de vérification a été envoyé à votre adresse. Veuillez le vérifier avant de vous connecter.',
        [{ text: 'OK', onPress: () => router.replace('/(auth)/download-models') }]
      );
    } catch (error: any) {
      themedAlert.alert('Erreur d\'inscription', error.message);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeInDown.delay(100)} style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Créer un compte</Text>
          <Text style={styles.subtitle}>Rejoignez YouMe</Text>
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(200)} style={styles.form}>
          <Controller
            control={control}
            name="email"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                label="Adresse email *"
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

          <Controller
            control={control}
            name="username"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                label="Username unique *"
                value={value}
                onChangeText={(t) => onChange(t.toLowerCase().replace(/[^a-z0-9._]/g, ''))}
                onBlur={onBlur}
                autoCapitalize="none"
                mode="outlined"
                style={[styles.input, { marginTop: SPACING.sm }]}
                outlineStyle={styles.inputOutline}
                textColor={colors.textPrimary}
                left={<TextInput.Icon icon="at" color={colors.textSecondary} />}
                error={!!errors.username}
                helperText="3-20 caractères, lettres, chiffres, . et _"
              />
            )}
          />
          {errors.username && <HelperText type="error">{errors.username.message}</HelperText>}

          <Controller
            control={control}
            name="displayName"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                label="Surnom affiché *"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                mode="outlined"
                style={[styles.input, { marginTop: SPACING.sm }]}
                outlineStyle={styles.inputOutline}
                textColor={colors.textPrimary}
                left={<TextInput.Icon icon="account-outline" color={colors.textSecondary} />}
                error={!!errors.displayName}
              />
            )}
          />
          {errors.displayName && <HelperText type="error">{errors.displayName.message}</HelperText>}

          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                label="Mot de passe *"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                secureTextEntry={!showPassword}
                mode="outlined"
                style={[styles.input, { marginTop: SPACING.sm }]}
                outlineStyle={styles.inputOutline}
                textColor={colors.textPrimary}
                left={<TextInput.Icon icon="lock-outline" color={colors.textSecondary} />}
                right={
                  <TextInput.Icon
                    icon={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    color={colors.textSecondary}
                    onPress={() => setShowPassword(!showPassword)}
                  />
                }
                error={!!errors.password}
              />
            )}
          />
          <PasswordStrengthBar password={password} />
          {errors.password && <HelperText type="error">{errors.password.message}</HelperText>}

          <Controller
            control={control}
            name="confirmPassword"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                label="Confirmer le mot de passe *"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                secureTextEntry={!showConfirm}
                mode="outlined"
                style={[styles.input, { marginTop: SPACING.sm }]}
                outlineStyle={styles.inputOutline}
                textColor={colors.textPrimary}
                left={<TextInput.Icon icon="lock-check-outline" color={colors.textSecondary} />}
                right={
                  <TextInput.Icon
                    icon={showConfirm ? 'eye-off-outline' : 'eye-outline'}
                    color={colors.textSecondary}
                    onPress={() => setShowConfirm(!showConfirm)}
                  />
                }
                error={!!errors.confirmPassword}
              />
            )}
          />
          {errors.confirmPassword && <HelperText type="error">{errors.confirmPassword.message}</HelperText>}

          <Button
            mode="contained"
            onPress={handleSubmit(onSubmit)}
            loading={isLoading}
            disabled={isLoading}
            style={styles.button}
            contentStyle={styles.buttonContent}
            labelStyle={styles.buttonLabel}
            buttonColor={colors.primary}
          >
            Créer mon compte
          </Button>

          <Text style={styles.terms}>
            En vous inscrivant, vous acceptez notre politique de confidentialité.
            Vos données sont stockées localement sur votre appareil.
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(400)} style={styles.footer}>
          <Text style={styles.footerText}>Déjà un compte ?</Text>
          <TouchableOpacity onPress={() => router.replace('/(auth)/login')}>
            <Text style={styles.loginLink}>Se connecter</Text>
          </TouchableOpacity>
        </Animated.View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function getStyles(colors: YoumeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flexGrow: 1, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.xl },
    header: { marginBottom: SPACING.xl },
    backButton: { marginBottom: SPACING.md },
    title: { fontSize: TYPOGRAPHY.size.xxl, fontWeight: '700', color: colors.textPrimary },
    subtitle: { fontSize: TYPOGRAPHY.size.md, color: colors.textSecondary, marginTop: 4 },
    form: { gap: SPACING.xs },
    input: { backgroundColor: colors.inputBackground },
    inputOutline: { borderColor: colors.divider, borderRadius: BORDER_RADIUS.md },
    button: { marginTop: SPACING.md, borderRadius: BORDER_RADIUS.md },
    buttonContent: { height: 50 },
    buttonLabel: { fontSize: TYPOGRAPHY.size.md, fontWeight: '600' },
    terms: { fontSize: TYPOGRAPHY.size.xs, color: colors.textMuted, textAlign: 'center', marginTop: SPACING.sm, lineHeight: 18 },
    footer: { flexDirection: 'row', justifyContent: 'center', gap: SPACING.xs, marginTop: SPACING.xl },
    footerText: { color: colors.textSecondary },
    loginLink: { color: colors.primary, fontWeight: '600' },
    debugLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: SPACING.lg },
    debugLinkText: { color: colors.textMuted, fontSize: TYPOGRAPHY.size.xs },
  });
}
