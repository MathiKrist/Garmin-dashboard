"""Log in to Garmin Connect once and save a token.

The password is only used here and never written to disk. After this,
the dashboard reuses the saved token (it refreshes itself), so you
normally only run this again if Garmin logs you out.
"""
from getpass import getpass

from garminconnect import Garmin

import config


def main():
    print(f"Token will be saved to {config.TOKEN_DIR}")
    email = input("Garmin email: ").strip()
    password = getpass("Garmin password: ")
    client = Garmin(
        email=email,
        password=password,
        prompt_mfa=lambda: input("MFA code from Garmin: ").strip(),
    )
    client.login(config.TOKEN_DIR)
    print(f"Logged in as {client.get_full_name() or email}. You can now run: python app.py")


if __name__ == "__main__":
    main()
