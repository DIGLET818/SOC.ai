# Gmail OAuth – Read alerts from your inbox

To load alerts from your Gmail (e.g. Case/Offense notification emails):

1. **Google Cloud Console**
   - Go to [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
   - Enable the **Gmail API** (APIs & Services → Library → Gmail API → Enable).
   - Go to **APIs & Services → Credentials** and create **OAuth 2.0 Client ID**.
   - Application type: **Web application** (or Desktop if you prefer).
   - Under **Authorized redirect URIs** add:  
     `http://127.0.0.1:5000/api/auth/google/callback`
   - Download the client config and save it as `Backend/credentials.json`.

2. **Run the backend from the Backend folder**
   ```bash
   cd Backend
   python main.py
   ```
   The app runs at `http://127.0.0.1:5000`.

3. **In the Sentinel-AI app**
   - Open the Alerts page. If Gmail is configured, you’ll see **Connect Gmail**.
   - Click it to sign in with Google and grant read-only access to Gmail.
   - After redirect back, click **Load from Gmail** to fetch recent emails that match `subject:Case OR subject:Offense` (configurable via API).

Emails are converted to alert-like rows and shown in the same table with a **Gmail** badge. The backend stores the refresh token in `Backend/token.json` (gitignored) so you stay connected until you revoke access or delete the token.
