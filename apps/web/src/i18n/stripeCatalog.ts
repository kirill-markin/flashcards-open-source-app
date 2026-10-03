import type englishStripeCopy from "../../../backend/src/billing/stripe/copy/locales/en.json";

type StripeCopy = Readonly<typeof englishStripeCopy>;
type StripeCopyGroup = keyof StripeCopy extends `${infer Group}.${string}` ? Group : never;

type StripeCatalog = {
  readonly [Group in StripeCopyGroup]: {
    readonly [Key in keyof StripeCopy as Key extends `${Group}.${infer Name}` ? Name : never]: string;
  };
};

function formatStripeMessage(message: string): string {
  return message.replace(/\{(count|price|date|provider|url)\}/g, "{{$1}}");
}

export function createStripeCatalog(copy: StripeCopy): StripeCatalog {
  return {
    product: {
      name: formatStripeMessage(copy["product.name"]),
      description: formatStripeMessage(copy["product.description"]),
      aiFeature: formatStripeMessage(copy["product.aiFeature"]),
      accentFeature: formatStripeMessage(copy["product.accentFeature"]),
    },
    portal: {
      headline: formatStripeMessage(copy["portal.headline"]),
    },
    offer: {
      title: formatStripeMessage(copy["offer.title"]),
      description: formatStripeMessage(copy["offer.description"]),
      aiBenefit: formatStripeMessage(copy["offer.aiBenefit"]),
      accentBenefit: formatStripeMessage(copy["offer.accentBenefit"]),
      price: formatStripeMessage(copy["offer.price"]),
      trial: formatStripeMessage(copy["offer.trial"]),
      startTrial: formatStripeMessage(copy["offer.startTrial"]),
      subscribe: formatStripeMessage(copy["offer.subscribe"]),
      renewalDisclosure: formatStripeMessage(copy["offer.renewalDisclosure"]),
      guestExplanation: formatStripeMessage(copy["offer.guestExplanation"]),
      addEmail: formatStripeMessage(copy["offer.addEmail"]),
      syncClarification: formatStripeMessage(copy["offer.syncClarification"]),
      taxDisclosure: formatStripeMessage(copy["offer.taxDisclosure"]),
      trialDisclosure: formatStripeMessage(copy["offer.trialDisclosure"]),
      trialEligibility: formatStripeMessage(copy["offer.trialEligibility"]),
      allowanceWindow: formatStripeMessage(copy["offer.allowanceWindow"]),
    },
    limit: {
      title: formatStripeMessage(copy["limit.title"]),
      freeExplanation: formatStripeMessage(copy["limit.freeExplanation"]),
      paidExplanation: formatStripeMessage(copy["limit.paidExplanation"]),
    },
    ownKey: {
      action: formatStripeMessage(copy["ownKey.action"]),
      explanation: formatStripeMessage(copy["ownKey.explanation"]),
    },
    legal: {
      privacy: formatStripeMessage(copy["legal.privacy"]),
      terms: formatStripeMessage(copy["legal.terms"]),
    },
    common: {
      close: formatStripeMessage(copy["common.close"]),
    },
    checkout: {
      opening: formatStripeMessage(copy["checkout.opening"]),
      confirming: formatStripeMessage(copy["checkout.confirming"]),
      confirmed: formatStripeMessage(copy["checkout.confirmed"]),
      delayed: formatStripeMessage(copy["checkout.delayed"]),
      interrupted: formatStripeMessage(copy["checkout.interrupted"]),
    },
    subscription: {
      refresh: formatStripeMessage(copy["subscription.refresh"]),
      manage: formatStripeMessage(copy["subscription.manage"]),
      stripeLabel: formatStripeMessage(copy["subscription.stripeLabel"]),
      mobileGuidance: formatStripeMessage(copy["subscription.mobileGuidance"]),
      trialEnd: formatStripeMessage(copy["subscription.trialEnd"]),
      renewal: formatStripeMessage(copy["subscription.renewal"]),
      cancelledRenewal: formatStripeMessage(copy["subscription.cancelledRenewal"]),
      paymentProblem: formatStripeMessage(copy["subscription.paymentProblem"]),
      expired: formatStripeMessage(copy["subscription.expired"]),
      lifetimeWithSubscription: formatStripeMessage(copy["subscription.lifetimeWithSubscription"]),
      unknown: formatStripeMessage(copy["subscription.unknown"]),
      accountChanged: formatStripeMessage(copy["subscription.accountChanged"]),
    },
    email: {
      trialReminderSubject: formatStripeMessage(copy["email.trialReminderSubject"]),
      trialReminderBody: formatStripeMessage(copy["email.trialReminderBody"]),
      paymentReceiptSubject: formatStripeMessage(copy["email.paymentReceiptSubject"]),
      paymentReceiptBody: formatStripeMessage(copy["email.paymentReceiptBody"]),
      refundReceiptSubject: formatStripeMessage(copy["email.refundReceiptSubject"]),
      refundReceiptBody: formatStripeMessage(copy["email.refundReceiptBody"]),
    },
    deletion: {
      warning: formatStripeMessage(copy["deletion.warning"]),
      cancelling: formatStripeMessage(copy["deletion.cancelling"]),
      cancellationFailed: formatStripeMessage(copy["deletion.cancellationFailed"]),
    },
  };
}
