import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const SPECIALTIES = [
  'anesthesiology',
  'crna',
  'hospitalist',
  'emergency-medicine',
  'family-medicine',
  'psychiatry',
  'ob-gyn',
  'general-surgery',
  'radiology',
  'pediatrics',
  'cardiology',
  'neurology',
  'other',
] as const;

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
] as const;

const jobs = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/jobs' }),
  schema: z.object({
    title: z.string().min(3).max(120),
    specialty: z.enum(SPECIALTIES),
    state: z.enum(US_STATES),
    city: z.string().min(1).max(80),
    facilityType: z.string().min(1).max(80),
    callType: z.string().optional(),
    schedule: z.string().optional(),
    lengthCategory: z.enum(['short', 'medium', 'long']),
    rateLow: z.number().int().positive().nullable().optional(),
    rateHigh: z.number().int().positive().nullable().optional(),
    emr: z.string().optional(),
    publishedAt: z.coerce.date(),
    // Evergreen contract: omit the field entirely. Reject null, blank, and
    // non-string/non-Date scalars (0, false, etc) to prevent z.coerce.date()
    // silently coercing them to 1970-01-01 (silent-expire trap).
    expiresAt: z.preprocess(
      (v) => {
        if (v === null || v === '' || v === undefined) return undefined;
        if (typeof v !== 'string' && !(v instanceof Date)) {
          throw new Error(
            'expiresAt must be omitted, a YYYY-MM-DD string, or a Date — falsy scalars rejected',
          );
        }
        return v;
      },
      z.coerce.date().optional(),
    ),
  }).refine(
    (j) => !(j.rateLow != null && j.rateHigh != null && j.rateLow > j.rateHigh),
    { message: 'rateLow cannot exceed rateHigh' },
  ),
});

const specialties = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/specialties' }),
  schema: z.object({
    title: z.string(),
    slug: z.enum(SPECIALTIES),
    summary: z.string().max(300),
    publishedAt: z.coerce.date(),
  }),
});

export const collections = { jobs, specialties };
