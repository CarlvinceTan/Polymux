export interface AccountProfileDto {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string;
}

export interface AccountStatusDto {
  signedIn: boolean;
  /** This build has no Polymux account to sign in to. */
  available: boolean;
  profile: AccountProfileDto | null;
  /** Other sessions saved on this machine, excluding the current profile. */
  accounts: AccountProfileDto[];
}
