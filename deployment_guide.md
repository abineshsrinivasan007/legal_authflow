# 🚀 Legal Authflow Deployment Guide (Free Tier)

This guide walks you through deploying the **Legal Authflow** Django project to **Render.com** (Web Service) using a free, permanent **Neon** PostgreSQL database. This setup will automatically run migrations and create/update your Django admin account during the build process without needing paid terminal access.

---

## 1️⃣ Set up a Permanent Database on Neon (Free Forever)

Since Render's free PostgreSQL databases expire and delete after 30 days, we will use **Neon**, which is completely free forever.

1. Go to [**Neon.tech**](https://neon.tech) and sign up (you can sign in with your GitHub account in 1 click).
2. Click **Create Project**.
3. Fill in the following details:
   * **Project Name**: `legal-authflow-db`
   * **Database Version**: *Leave as default (PostgreSQL 16)*
   * **Region**: Select **Singapore (ap-southeast-1)** (this is closest to India and will keep latency low).
4. Click **Create Project**.
5. Once created, you will see a **Connection Details** popup.
6. Make sure the language dropdown is set to **URI** or **Connection String**.
7. Copy the entire connection string (it will start with `postgresql://...`). Save this URL; you will use it as the `DATABASE_URL` in Render.

---

## 2️⃣ Create your Web Service on Render

1. Go to your [**Render Dashboard**](https://dashboard.render.com/).
2. Click **New +** (top right) and select **Web Service**.
3. Search for and **Connect** your personal repository: **`abineshsrinivasan007/legal_authflow`**.
4. Fill in the Web Service configuration form:
   * **Name**: `legal-authflow`
   * **Region**: Select **Singapore (ap-southeast)** (this **must** match your Neon database region).
   * **Branch**: Select **`main`**.
   * **Language**: Change from `Docker` to **`Python`** (Render will detect your Dockerfile and default to Docker, so make sure to select **Python** from the dropdown).
   * **Build Command**: `./build.sh`
   * **Start Command**: `gunicorn BackEnd.legal_backend.wsgi:application`
   * **Instance Type**: Select **Free ($0/month)**.

---

## 3️⃣ Configure Environment Variables on Render

Before clicking deploy, scroll down the Web Service page and click on **Advanced** or navigate to the **Environment** tab on the left menu after creation to add these variables:

| Key | Value | Description |
| :--- | :--- | :--- |
| **`DATABASE_URL`** | *Paste your Neon Connection String* | The connection URL copied from Neon.tech |
| **`SUPERUSER_PASSWORD`** | *Your choice (e.g. MyPassword123)* | The password you will use to log into the Django Admin dashboard |
| **`SUPERUSER_EMAIL`** | *Your email (e.g. name@example.com)* | The email address associated with the admin account |
| **`DEBUG`** | `False` | Run Django in production security mode |

Click **Save Changes** or **Create Web Service**.

---

## 4️⃣ Accessing your Live Site and Admin Panel

Render will now run your `./build.sh` script, which installs packages, runs database migrations on Neon, collects your static files, and creates your superuser account.

1. **Deploy Status**: Wait about 2–3 minutes for the log to show `Deploy live`.
2. **Visit Site**: Click the live URL at the top of your Render Web Service dashboard (e.g. `https://legal-authflow.onrender.com`).
3. **Visit Django Admin**: Go to `https://your-app-name.onrender.com/admin`.
4. **Log In**:
   * **Username**: `admin`
   * **Password**: *(The password you entered in your `SUPERUSER_PASSWORD` environment variable)*

---

> [!NOTE]
> Because you are using Render's Free tier, the web server will spin down (sleep) after 15 minutes of inactivity. When someone clicks your link after a period of inactivity, it will take about 50–60 seconds to wake up and load the page. This is normal and expected for Render's free tier. Your database on Neon will remain online forever!
