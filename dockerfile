# 1. Base Image
# Use an official Node.js runtime as the parent image.
# We often use a 'slim' or 'alpine' version for smaller image size.
FROM node:20-alpine

# 2. Set Working Directory
# Create and set a directory where the application code will live inside the container.
WORKDIR /usr/src/app

# 3. Copy package.json and install dependencies
# A crucial optimization: copy only the package.json and package-lock.json files first,
# then run npm install. Docker caches this layer. If you only change your code (not dependencies),
# the install step won't re-run, making builds faster.
COPY package*.json ./

RUN npm install

# 4. Copy Application Code
# Copy the rest of the application source code into the working directory.
COPY . .

# 5. Expose Port
# Inform Docker that the container listens on the specified network ports at runtime.
# This is typically the port your Node.js app runs on (e.g., 3000, 8080).
EXPOSE 8080

# 6. Command to Run the Application
# Define the command to run your application when the container starts.
CMD [ "node", "server.js" ]
# (Replace 'server.js' with your main application file, e.g., 'index.js')