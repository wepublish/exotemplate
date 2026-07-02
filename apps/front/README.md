## Deployment

This project is deployed automatically via CI/CD:

- **Staging**  
  Every push to the `main` branch is automatically deployed to **staging**.

- **Production**  
  Every Git tag matching `v*` (e.g. `v1.2.0`) is automatically deployed to **production**.

## Setup

Make sure to install the dependencies:

```bash
npm install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
npm run dev
```

## Production

Build the application for production:

```bash
npm run build
```

Locally preview production build:

```bash
npm run preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.

## Deployment

This project is deployed automatically via CI/CD:

- **Staging**  
  Every push to the `main` branch is automatically deployed to **staging**.

- **Production**  
  Every Git tag matching `v*` (e.g. `v1.2.0`) is automatically deployed to **production**.
