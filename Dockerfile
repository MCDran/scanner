# Use an official Node.js runtime as a parent image
FROM node:16

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy the package.json and package-lock.json files
COPY package*.json ./

# Install the app dependencies
RUN npm install

# Copy the rest of your application’s source code
COPY . .

# Expose the port your app will run on
EXPOSE 3000

# Command to run your app
CMD ["node", "server.js"]
