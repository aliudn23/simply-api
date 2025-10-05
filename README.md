## Authentication

This API uses Bearer Token authentication for the initial login request. Clients must include an `Authorization` header with a static token when requesting login.

**Example:**

URL of API is https://simply-api.onrender.com try to open the url if frontend is not connected to api since its free version.

Include this hvptSQkJcYA_rj5uKbKZ44w1L9BPBi_4 in your login request to authenticate.

## Data Storage

This API uses **MongoDB** to persist user sessions and tasks. When a user logs in, their session information is stored in a MongoDB collection. Similarly, all tasks created, updated, or deleted by users are managed and saved in MongoDB, ensuring data is retained across server restarts and can be accessed securely.
