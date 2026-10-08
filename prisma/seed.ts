import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // This creates demo and personal accounts with a password that is public in git: it must never run against the live database.
  let host = '';
  try {
    host = new URL(process.env.DATABASE_URL || '').hostname;
  } catch {
    /* no usable DATABASE_URL */
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    console.error(`Refusing to seed: DATABASE_URL points at "${host || 'unknown'}", not a local database.`);
    process.exit(1);
  }
  console.log('Seeding Aaptha database...');

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('CareCircleDemo2025!', salt);

  // 1. Create Primary Demo User
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@carecircle.in' },
    update: {},
    create: {
      id: 'usr_demo_123',
      name: 'Caregiver Demo',
      email: 'demo@carecircle.in',
      phone: '+91 98765 43210',
      avatar: 'SR',
      emailVerified: true,
      phoneVerified: true,
      passwordHash: passwordHash,
      subscription: {
        create: {
          id: 'sub_demo_family',
          planId: 'family',
          status: 'trialing',
          startDate: new Date(Date.now() - 5 * 86400000),
          trialEndsAt: new Date(Date.now() + 9 * 86400000),
          currentPeriodEnd: new Date(Date.now() + 9 * 86400000),
          cancelAtPeriodEnd: false,
          amount: 1299,
          paymentMethodBrand: 'UPI / HDFC',
          paymentMethodLast4: '4242',
          razorpaySubscriptionId: 'sub_demo_rzp_9901'
        }
      },
      notificationPreferences: {
        create: {
          whatsapp: true,
          sms: true,
          email: true,
          push: false,
          minimumAlertLevel: 1
        }
      },
      invoices: {
        create: [
          {
            id: 'inv_101',
            invoiceNumber: 'CC-2025-001',
            date: new Date(Date.now() - 5 * 86400000).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }),
            amount: 0,
            planName: 'Family Care (14-Day Free Trial Auth)',
            status: 'paid',
            paymentMethod: 'UPI AutoPay (₹0 Auth)'
          }
        ]
      }
    }
  });

  // 2. Also ensure sathwik.fr@gmail.com exists
  await prisma.user.upsert({
    where: { email: 'sathwik.fr@gmail.com' },
    update: {},
    create: {
      id: 'usr_sathwik_fr',
      name: 'Sathwik Rao',
      email: 'sathwik.fr@gmail.com',
      phone: '+91 98765 43210',
      avatar: 'SR',
      emailVerified: true,
      phoneVerified: true,
      passwordHash: passwordHash,
      notificationPreferences: {
        create: {
          whatsapp: true,
          sms: true,
          email: true,
          push: false,
          minimumAlertLevel: 1
        }
      }
    }
  });

  // 3. Seed Primary Parent: Amma (Lakshmi Rao)
  const ammaId = 'parent_amma_01';
  const existingAmma = await prisma.parentProfile.findUnique({ where: { id: ammaId } });
  if (!existingAmma) {
    await prisma.parentProfile.create({
      data: {
        id: ammaId,
        userId: demoUser.id,
        name: 'Amma (Lakshmi Rao)',
        relationship: 'Mother',
        phone: '+91 98450 12345',
        language: 'Hindi & English',
        timezone: 'Asia/Kolkata (IST)',
        callTime: '09:00 AM',
        isPaused: false,
        consentGiven: true,
        callSchedule: {
          create: [
            {
              id: 'slot_amma_morn',
              time: '08:30 AM',
              slot: 'morning',
              label: 'Morning Medicine & Breakfast Check-in',
              linkedMedicineNames: ['Telmisartan (BP Tablet)'],
              isActive: true
            },
            {
              id: 'slot_amma_night',
              time: '09:00 PM',
              slot: 'bedtime',
              label: 'Night Medicine Check-in',
              linkedMedicineNames: ['Metformin (Sugar)'],
              isActive: true
            }
          ]
        },
        medicines: {
          create: [
            {
              id: 'med_01',
              name: 'Telmisartan (BP Tablet)',
              dosage: '40mg after breakfast',
              timeOfDay: 'morning',
              timingSlots: ['morning'],
              foodRelation: 'after_food',
              frequency: 'daily',
              isActive: true
            },
            {
              id: 'med_02',
              name: 'Metformin (Sugar)',
              dosage: '500mg with dinner',
              timeOfDay: 'evening',
              timingSlots: ['bedtime'],
              foodRelation: 'with_food',
              frequency: 'daily',
              isActive: true
            },
            {
              id: 'med_03',
              name: 'Calcium & Vit D3',
              dosage: '1 tablet post-lunch',
              timeOfDay: 'afternoon',
              timingSlots: ['afternoon'],
              foodRelation: 'after_food',
              frequency: 'daily',
              isActive: true
            }
          ]
        },
        emergencyContacts: {
          create: [
            {
              id: 'emg_01',
              name: 'Sathwik Rao (Son)',
              relation: 'Son (Bangalore / Remote)',
              phone: '+91 98765 43210',
              priority: 'primary'
            },
            {
              id: 'emg_02',
              name: 'Dr. Ramesh (Family Physician)',
              relation: 'Doctor (Indiranagar Clinic)',
              phone: '+91 98440 99881',
              priority: 'secondary'
            }
          ]
        },
        callLogs: {
          create: [
            {
              id: 'call_01',
              scheduledTime: 'Today, 09:00 AM',
              actualAnswerTime: 'Today, 10:14 AM (2nd attempt)',
              status: 'answered',
              durationSeconds: 142,
              medicationConfirmed: true,
              mood: 'cheerful',
              summary: 'Confirmed Telmisartan 40mg with warm water. Took 20-min morning balcony walk. Mood was cheerful.',
              notes: 'Amma mentioned she was tending to potted plants earlier at 9 AM.'
            },
            {
              id: 'call_02',
              scheduledTime: 'Yesterday, 09:00 AM',
              actualAnswerTime: 'Yesterday, 10:18 AM',
              status: 'answered',
              durationSeconds: 128,
              medicationConfirmed: true,
              mood: 'calm',
              summary: 'BP tablet confirmed. Blood pressure checked with home monitor (124/82). Feeling calm and well.'
            }
          ]
        },
        alerts: {
          create: [
            {
              id: 'alt_01',
              level: 1,
              title: 'Morning Check-in Complete',
              message: 'Amma confirmed BP tablet Telmisartan. Mood cheerful.',
              channel: 'whatsapp',
              timestamp: 'Today, 10:15 AM',
              status: 'sent'
            }
          ]
        }
      }
    });
  }

  // 4. Seed Appa (K. V. Rao)
  const appaId = 'parent_appa_02';
  const existingAppa = await prisma.parentProfile.findUnique({ where: { id: appaId } });
  if (!existingAppa) {
    await prisma.parentProfile.create({
      data: {
        id: appaId,
        userId: demoUser.id,
        name: 'Appa (K. V. Rao)',
        relationship: 'Father',
        phone: '+91 98450 67890',
        language: 'English & Kannada',
        timezone: 'Asia/Kolkata (IST)',
        callTime: '08:30 AM',
        isPaused: false,
        consentGiven: true
      }
    });
  }

  console.log('Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
