/** Cognito PreSignUp trigger: auto-confirms user and verifies email. */
type PreSignUpEvent = {
  request: {
    userAttributes: Record<string, string | undefined>;
  };
  response: {
    autoConfirmUser?: boolean;
    autoVerifyEmail?: boolean;
  };
};

export const handler = async (event: PreSignUpEvent) => {
  event.response.autoConfirmUser = true;
  if (event.request.userAttributes.email) {
    event.response.autoVerifyEmail = true;
  }
  return event;
};
