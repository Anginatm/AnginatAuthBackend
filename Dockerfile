FROM node:20-alpine

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install


# Install node-gyp
RUN npm install node-gyp -g

# Copy source code
COPY . .

# Expose port
EXPOSE 5000

# Start the service
CMD ["npm", "start"]