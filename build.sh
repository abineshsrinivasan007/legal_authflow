#!/usr/bin/env bash
# exit on error
set -o errexit

# Install dependencies for Python
pip install -r BackEnd/requirements.txt

# Run migrations
python BackEnd/manage.py migrate

# Compile/Collect static files
python BackEnd/manage.py collectstatic --no-input

# Automatically create or update the superuser to match the Render environment variables
python BackEnd/manage.py shell -c "
import os
from django.contrib.auth import get_user_model
User = get_user_model()
username = 'admin'
email = os.environ.get('SUPERUSER_EMAIL', 'admin@example.com')
password = os.environ.get('SUPERUSER_PASSWORD', 'adminpassword123')

u, created = User.objects.get_or_create(username=username, defaults={'email': email})
u.set_password(password)
u.is_superuser = True
u.is_staff = True
u.save()

if created:
    print('Superuser created successfully!')
else:
    print('Superuser password updated successfully!')
"
