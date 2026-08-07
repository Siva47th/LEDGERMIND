# Use an official Node runtime as a parent image
FROM node:20-alpine

# Set work directory
WORKDIR /app

# Install app dependencies
COPY package*.json /app/
RUN npm install

# Copy project files
COPY . /app/

# Expose port 5173 for Vite
EXPOSE 5173

# Start Vite dev server
CMD ["npm", "run", "dev"]
