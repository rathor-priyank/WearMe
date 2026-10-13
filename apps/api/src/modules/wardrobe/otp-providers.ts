import { ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import type {
  AuthChannelCapability,
  OtpChannel,
  PartnerStorePublicInfo,
} from '@wearme/shared';

export interface OtpDeliveryResult {
  delivered: boolean;
  providerName: string;
}

export interface OtpDeliveryProvider {
  readonly channel: OtpChannel;
  readonly label: string;
  readonly providerName: string;
  isLiveConfigured(): boolean;
  isEnabled(nodeEnv: string): boolean;
  sendOtp(destination: string, otpCode: string): Promise<OtpDeliveryResult>;
}

/**
 * WhatsApp OTP Provider (Official WhatsApp Cloud API / Webhook integration boundary).
 */
export class WhatsAppOtpProvider implements OtpDeliveryProvider {
  readonly channel: OtpChannel = 'whatsapp';
  readonly label = 'WhatsApp OTP';
  readonly providerName = 'whatsapp-cloud-webhook';

  isLiveConfigured(): boolean {
    return Boolean(
      process.env['WHATSAPP_OTP_WEBHOOK_URL'] && process.env['WHATSAPP_API_TOKEN'],
    );
  }

  isEnabled(nodeEnv: string): boolean {
    if (process.env['DISABLE_WHATSAPP_OTP'] === 'true') {
      return false;
    }
    return nodeEnv !== 'production' || this.isLiveConfigured();
  }

  async sendOtp(destination: string, otpCode: string): Promise<OtpDeliveryResult> {
    if (this.isLiveConfigured()) {
      await axios.post(
        process.env['WHATSAPP_OTP_WEBHOOK_URL']!,
        {
          channel: 'whatsapp',
          to: destination,
          code: otpCode,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env['WHATSAPP_API_TOKEN']!}`,
          },
          timeout: 8000,
        },
      );
      return { delivered: true, providerName: this.providerName };
    }

    if (process.env['NODE_ENV'] === 'production') {
      throw new ServiceUnavailableException(
        'WhatsApp OTP delivery provider is not configured in production.',
      );
    }

    return { delivered: true, providerName: 'dev-local-whatsapp' };
  }
}

/**
 * SMS / Mobile OTP Provider (Twilio / Webhook integration boundary).
 */
export class SmsOtpProvider implements OtpDeliveryProvider {
  readonly channel: OtpChannel = 'sms';
  readonly label = 'SMS / Mobile OTP';
  readonly providerName = 'sms-gateway-webhook';

  isLiveConfigured(): boolean {
    return Boolean(
      (process.env['SMS_OTP_WEBHOOK_URL'] && process.env['SMS_API_TOKEN']) ||
        (process.env['TWILIO_ACCOUNT_SID'] &&
          process.env['TWILIO_AUTH_TOKEN'] &&
          process.env['TWILIO_FROM_NUMBER']),
    );
  }

  isEnabled(nodeEnv: string): boolean {
    if (process.env['DISABLE_SMS_OTP'] === 'true') {
      return false;
    }
    return nodeEnv !== 'production' || this.isLiveConfigured();
  }

  async sendOtp(destination: string, otpCode: string): Promise<OtpDeliveryResult> {
    if (process.env['SMS_OTP_WEBHOOK_URL'] && process.env['SMS_API_TOKEN']) {
      await axios.post(
        process.env['SMS_OTP_WEBHOOK_URL'],
        {
          channel: 'sms',
          to: destination,
          code: otpCode,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env['SMS_API_TOKEN']}`,
          },
          timeout: 8000,
        },
      );
      return { delivered: true, providerName: this.providerName };
    }

    if (process.env['NODE_ENV'] === 'production' && !this.isLiveConfigured()) {
      throw new ServiceUnavailableException(
        'SMS OTP delivery provider is not configured in production.',
      );
    }

    return { delivered: true, providerName: 'dev-local-sms' };
  }
}

/**
 * Email OTP Provider (Resend / Transactional Email Webhook integration boundary).
 */
export class EmailOtpProvider implements OtpDeliveryProvider {
  readonly channel: OtpChannel = 'email';
  readonly label = 'Email OTP';
  readonly providerName = 'transactional-email-webhook';

  isLiveConfigured(): boolean {
    return Boolean(
      (process.env['EMAIL_OTP_WEBHOOK_URL'] && process.env['EMAIL_API_TOKEN']) ||
        process.env['RESEND_API_KEY'],
    );
  }

  isEnabled(nodeEnv: string): boolean {
    if (process.env['DISABLE_EMAIL_OTP'] === 'true') {
      return false;
    }
    return nodeEnv !== 'production' || this.isLiveConfigured();
  }

  async sendOtp(destination: string, otpCode: string): Promise<OtpDeliveryResult> {
    if (process.env['EMAIL_OTP_WEBHOOK_URL'] && process.env['EMAIL_API_TOKEN']) {
      await axios.post(
        process.env['EMAIL_OTP_WEBHOOK_URL'],
        {
          channel: 'email',
          to: destination,
          code: otpCode,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env['EMAIL_API_TOKEN']}`,
          },
          timeout: 8000,
        },
      );
      return { delivered: true, providerName: this.providerName };
    }

    if (process.env['NODE_ENV'] === 'production' && !this.isLiveConfigured()) {
      throw new ServiceUnavailableException(
        'Email OTP delivery provider is not configured in production.',
      );
    }

    return { delivered: true, providerName: 'dev-local-email' };
  }
}

export function createDefaultOtpProviders(): Record<OtpChannel, OtpDeliveryProvider> {
  return {
    whatsapp: new WhatsAppOtpProvider(),
    sms: new SmsOtpProvider(),
    email: new EmailOtpProvider(),
  };
}

export function getAuthChannelCapabilities(
  providers: Record<OtpChannel, OtpDeliveryProvider>,
  nodeEnv: string,
): AuthChannelCapability[] {
  return (['whatsapp', 'sms', 'email'] as const).map((ch) => {
    const provider = providers[ch];
    return {
      channel: ch,
      label: provider.label,
      enabled: provider.isEnabled(nodeEnv),
      providerName: provider.providerName,
      isLiveConfigured: provider.isLiveConfigured(),
    };
  });
}

// ─── Trusted Server-Side Partner Store Registry ──────────────────────────────

const SAFE_STORE_ID_REGEX = /^[a-zA-Z0-9_-]{2,64}$/;

export const PARTNER_STORE_REGISTRY: Record<string, PartnerStorePublicInfo> = {
  store_indiranagar_01: {
    storeId: 'store_indiranagar_01',
    storeName: 'Studio Namma Indiranagar',
    city: 'Bengaluru',
    verifiedPartner: true,
    supportedSubcategories: ['TSHIRT', 'SHIRT', 'TOP', 'KURTA', 'JACKET', 'NECKLACE'],
  },
  store_koramangala_02: {
    storeId: 'store_koramangala_02',
    storeName: 'Studio Koramangala Flagship',
    city: 'Bengaluru',
    verifiedPartner: true,
    supportedSubcategories: ['TSHIRT', 'SHIRT', 'TOP', 'KURTA', 'JACKET'],
  },
  store_jayanagar_03: {
    storeId: 'store_jayanagar_03',
    storeName: 'Studio Jayanagar Boutique',
    city: 'Bengaluru',
    verifiedPartner: true,
    supportedSubcategories: ['TSHIRT', 'SHIRT', 'TOP', 'KURTA', 'JACKET'],
  },
  test: {
    storeId: 'test',
    storeName: 'WearMe Sandbox Partner Boutique',
    city: 'Bengaluru',
    verifiedPartner: true,
    supportedSubcategories: ['TSHIRT', 'SHIRT', 'TOP', 'KURTA', 'JACKET'],
  },
};

/**
 * Resolves a QR `storeId` against the trusted server-side partner store registry.
 * Never trusts URL-provided `storeName` for registered partner stores, preventing
 * query-string display tampering or phishing injection.
 */
export function resolveTrustedStoreInfo(
  rawStoreId?: string | null,
): PartnerStorePublicInfo | null {
  if (!rawStoreId || typeof rawStoreId !== 'string') {
    return null;
  }
  const trimmed = rawStoreId.trim();
  if (!SAFE_STORE_ID_REGEX.test(trimmed)) {
    return null;
  }
  const registered = PARTNER_STORE_REGISTRY[trimmed];
  if (registered) {
    return registered;
  }
  return {
    storeId: trimmed,
    storeName: `Partner Boutique (${trimmed})`,
    city: 'Partner Location',
    verifiedPartner: false,
    supportedSubcategories: ['TSHIRT', 'SHIRT', 'TOP', 'KURTA', 'JACKET'],
  };
}

