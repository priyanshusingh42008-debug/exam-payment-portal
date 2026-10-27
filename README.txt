INDEPENDENT IT MOCK TEST PAGE TEMPLATES

Files:
- catalogue.html
- test-details.html
- site.css

These are static page templates, not a live payment integration.
1. Replace every [placeholder] with accurate information; do not publish with placeholders.
2. Only advertise formats, schedules, score reports, certificates, and features you really provide.
3. Do not use college/government branding or claim official affiliation without authorization.
4. Do not show payment success or issue a paid receipt until payment is confirmed.
5. In your existing Node/Express repository, put the files in the folder served as static assets (commonly public/). Check whether your server already has app.use(express.static('public')); do not add a duplicate unnecessarily.
6. Commit/push the changes to the Git repository connected to Render, or use your current deployment workflow.
7. After deployment, test https://YOUR-RENDER-DOMAIN/catalogue.html and https://YOUR-RENDER-DOMAIN/test-details.html, replacing the example domain with your actual Render domain.
8. Check links and mobile layout.
9. A catalogue page does not guarantee Razorpay approval. Make sure service description, price, refund policy, organizer details, and payment flow match the real service. Follow Razorpay's current onboarding instructions and do not enable live collection until approved.
