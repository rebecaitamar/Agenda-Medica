import "server-only";
import { cache } from "react";
import { sql, type Db } from "./db";

export type Profile = {
  id: string;
  honorific: string;
  fullName: string | null;
  licenseNumber: string | null;
  bio: string | null;
  photoUrl: string | null;
};

export type ClinicSettings = {
  profileId: string;
  appName: string;
  addressLine: string | null;
  addressDetails: string | null;
  city: string | null;
  mapsUrl: string | null;
  arrivalInstructions: string | null;
  publicHoursText: string | null;
  showPublicHours: boolean;
  contactPhone: string | null;
  contactWhatsapp: string | null;
  contactEmail: string | null;
  timezone: string;
  phoneRequired: boolean;
  requireEmailVerification: boolean;
  allowPatientCancel: boolean;
  allowPatientReschedule: boolean;
  patientChangeMinHours: number;
  reminderHoursBefore: number;
  holdMinutes: number;
  cancellationPolicyText: string | null;
  privacyControllerName: string | null;
  privacyControllerContact: string | null;
};

export type Specialty = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
  active: boolean;
  sortOrder: number;
};

export type SiteConfig = { settings: ClinicSettings; profile: Profile };

export async function loadSiteConfig(db: Db = sql): Promise<SiteConfig> {
  const [settings] = await db<ClinicSettings[]>`select * from clinic_settings where id`;
  if (!settings) throw new Error("No existe la configuración del consultorio (¿se ejecutaron las migraciones?)");
  const [profile] = await db<Profile[]>`select * from profiles where id = ${settings.profileId}`;
  return { settings, profile };
}

/** Configuración cacheada durante el render de una solicitud. */
export const getSiteConfig = cache(() => loadSiteConfig());

export async function listSpecialties(opts: { onlyActive?: boolean } = {}, db: Db = sql) {
  const rows = await db<Specialty[]>`
    select * from specialties
    ${opts.onlyActive ? db`where active` : db``}
    order by sort_order, name`;
  return rows;
}

export const getActiveSpecialties = cache(() => listSpecialties({ onlyActive: true }));

/** Nombre visible de la profesional, o null si todavía no se configuró. */
export function doctorDisplayName(profile: Profile) {
  if (!profile.fullName) return null;
  return [profile.honorific, profile.fullName].filter(Boolean).join(" ");
}

export function fullAddress(s: ClinicSettings) {
  return [s.addressLine, s.addressDetails, s.city].filter(Boolean).join(", ") || null;
}
