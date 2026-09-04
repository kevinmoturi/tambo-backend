import config from '../config/config';
import TrustedContact from '../models/trustedContact.model';
import type { ITrustedContact } from '../models/trustedContact.model';
import User from '../models/user.model';
import { AppError } from '../utils/appError';
import { isDuplicateKeyError } from '../utils/mongoErrors';
import { generateOpaqueToken, hashOpaqueToken } from '../utils/tokens';
import { mailer } from './mailer';
import type { TrustedContactInput } from '../validation/trustedContact.schema';

/**
 * Trusted contacts are third parties: they never installed Tambo and never
 * agreed to receive a stranger's theft alerts. Nomination therefore sends THEM
 * a consent request with equal-weight accept/decline links, and their answer -
 * not the owner's checkbox - sets the state (Evidence doc S5.2).
 */

const consentExpiry = (): Date =>
  new Date(
    Date.now() + config.trustedContacts.consentTtlDays * 24 * 60 * 60 * 1000,
  );

const consentUrl = (token: string, action: 'accept' | 'decline'): string =>
  `${config.publicApiUrl}/api/v1/consent/${token}/${action}`;

/** Fire-and-forget, like every other mail: provider latency must not block the API. */
const sendNomination = (
  contact: ITrustedContact,
  ownerName: string,
  token: string,
): void => {
  void mailer
    .send({
      to: contact.email,
      subject: `${ownerName} wants you as their Tambo emergency contact`,
      text: [
        `Hi ${contact.name},`,
        '',
        `${ownerName} uses Tambo to protect their phone against theft, and has`,
        'nominated you as their trusted contact. If you accept, Tambo will email',
        `you an alert with the phone's last known details if it is ever stolen,`,
        `so you can help ${ownerName} act quickly.`,
        '',
        `Accept:  ${consentUrl(token, 'accept')}`,
        `Decline: ${consentUrl(token, 'decline')}`,
        '',
        `This choice is yours - ${ownerName} cannot make it for you. If you do`,
        'nothing, the link expires in ' +
          `${config.trustedContacts.consentTtlDays} days and you will not be contacted again.`,
      ].join('\n'),
    })
    .catch((error) => {
      console.error('Failed to send trusted-contact nomination email:', error);
    });
};

export const create = async (
  userId: string,
  input: TrustedContactInput,
): Promise<ITrustedContact> => {
  const count = await TrustedContact.countDocuments({ user: userId });
  if (count >= config.trustedContacts.max) {
    throw AppError.badRequest(
      `You can have at most ${config.trustedContacts.max} trusted contacts.`,
      'contact_limit_reached',
    );
  }

  const owner = await User.findById(userId);
  if (!owner) throw AppError.unauthorized();

  if (input.email === owner.email) {
    throw AppError.badRequest(
      'You cannot nominate yourself as your trusted contact.',
      'contact_is_self',
    );
  }

  const token = generateOpaqueToken();

  let contact: ITrustedContact;
  try {
    contact = await TrustedContact.create({
      user: userId,
      name: input.name,
      email: input.email,
      ...(input.phone ? { phone: input.phone } : {}),
      consentTokenHash: hashOpaqueToken(token),
      consentExpiresAt: consentExpiry(),
      consentRequestedAt: new Date(),
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw AppError.conflict(
        'You have already nominated that email address.',
        'contact_exists',
      );
    }
    throw error;
  }

  sendNomination(contact, owner.name, token);
  return contact;
};

export const list = (userId: string): Promise<ITrustedContact[]> =>
  TrustedContact.find({ user: userId }).sort({ createdAt: -1 }).exec();

export const remove = async (
  userId: string,
  contactId: string,
): Promise<void> => {
  const result = await TrustedContact.deleteOne({
    _id: contactId,
    user: userId,
  });
  if (result.deletedCount === 0) {
    throw AppError.notFound('Trusted contact not found.', 'contact_not_found');
  }
};

/**
 * Re-sends the nomination with a FRESH token (the old link dies), cooldown
 * limited so an owner cannot use Tambo to pester a third party's mailbox.
 */
export const resendNomination = async (
  userId: string,
  contactId: string,
): Promise<void> => {
  const contact = await TrustedContact.findOne({
    _id: contactId,
    user: userId,
  });
  if (!contact)
    throw AppError.notFound('Trusted contact not found.', 'contact_not_found');

  if (contact.consentState !== 'pending') {
    throw AppError.badRequest(
      'This contact has already responded to the nomination.',
      'contact_already_responded',
    );
  }

  const cooldownMs = config.trustedContacts.nominationCooldownSeconds * 1000;
  const waitMs =
    (contact.consentRequestedAt?.getTime() ?? 0) + cooldownMs - Date.now();
  if (waitMs > 0) {
    throw AppError.tooManyRequests(
      'Please wait before re-sending the nomination.',
      Math.ceil(waitMs / 1000),
    );
  }

  const owner = await User.findById(userId);
  if (!owner) throw AppError.unauthorized();

  const token = generateOpaqueToken();
  contact.consentTokenHash = hashOpaqueToken(token);
  contact.consentExpiresAt = consentExpiry();
  contact.consentRequestedAt = new Date();
  await contact.save();

  sendNomination(contact, owner.name, token);
};

/**
 * The contact's own answer, via the emailed link. Atomic claim on the token
 * hash (house discipline): the link works exactly once, and a concurrent
 * double-click cannot record two answers.
 */
export const respond = async (
  token: string,
  action: 'accept' | 'decline',
): Promise<ITrustedContact> => {
  const contact = await TrustedContact.findOneAndUpdate(
    {
      consentTokenHash: hashOpaqueToken(token),
      consentState: 'pending',
      consentExpiresAt: { $gt: new Date() },
    },
    {
      $set: {
        consentState: action === 'accept' ? 'opted_in' : 'declined',
        respondedAt: new Date(),
      },
      $unset: { consentTokenHash: 1, consentExpiresAt: 1 },
    },
    { new: true },
  );

  if (!contact) {
    throw AppError.unauthorized(
      'This link is invalid, expired, or already used.',
      'invalid_consent_token',
    );
  }

  return contact;
};
