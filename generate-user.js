const fs = require('fs');

function generateRandomUser() {
  const domains = ['ntnx.local'];
  const firstNames = [
  'Swift', 'Silent', 'Clever', 'Lunar', 'Solar', 'Electric', 'Mystic', 'Crimson', 'Azure', 'Noble',
  'Wandering', 'Epic', 'Phantom', 'Iron', 'Golden', 'Ancient', 'Hidden', 'Jolly', 'Quiet', 'Velvet',
  'Rusty', 'Cosmic', 'Lucky', 'Savage', 'Happy', 'Midnight', 'Fuzzy', 'Dark', 'Bright', 'Silent',
  'Steel', 'Virtual', 'Alpha', 'Omega', 'Echo', 'Neon', 'Hyper', 'Ghost', 'Wild', 'Lonely',
  'Bold', 'Brave', 'Curious', 'Dapper', 'Eager', 'Fierce', 'Gentle', 'Honest', 'Icy', 'Jaded',
  'Keen', 'Lazy', 'Mighty', 'Nervous', 'Odd', 'Proud', 'Quick', 'Relentless', 'Shiny', 'Tiny',
  'Untamed', 'Vivid', 'Witty', 'Expert', 'Young', 'Zesty', 'Royal', 'Quirky', 'Prime', 'Ornate',
  'Natural', 'Majestic', 'Kinetic', 'Jubilant', 'Infinite', 'Hollow', 'Grand', 'Frosty', 'Enchanted', 'Dynamic',
  'Crystalline', 'Blazing', 'Atomic', 'Amber', 'Tropical', 'Spectral', 'Rocky', 'Polar', 'Mystical', 'Mechanical',
  'Legendary', 'Industrial', 'Hollow', 'Galactic', 'Fiery', 'Eternal', 'Digital', 'Chaotic', 'Blitz', 'Atomic'
];
  const lastNames = [
  'Phoenix', 'Wolf', 'Ninja', 'Dragon', 'Hawk', 'Captain', 'Guardian', 'Knight', 'Samurai', 'Wizard',
  'terminal', 'Drifter', 'Runner', 'Panda', 'Fox', 'Raven', 'Titan', 'Giant', 'Dwarf', 'Elf',
  'Goblin', 'Spectre', 'Lion', 'Tiger', 'Bear', 'Falcon', 'Eagle', 'Owl', 'Shark', 'Whale',
  'Rider', 'Stranger', 'Pilgrim', 'Nomad', 'Warrior', 'Sage', 'Bard', 'Merchant', 'Emperor', 'Duke',
  'Prince', 'King', 'Queen', 'Robot', 'Android', 'Cyborg', 'Algorithm', 'Code', 'Byte', 'Pixel',
  'Catalyst', 'Vortex', 'Nebula', 'Galaxy', 'Comet', 'Meteor', 'Planet', 'Star', 'Sun', 'Moon',
  'Thunder', 'Lightning', 'Storm', 'Rain', 'River', 'Mountain', 'Valley', 'Canyon', 'Forest', 'Desert',
  'Ocean', 'Island', 'Glacier', 'Volcano', 'Echo', 'Shadow', 'Spirit', 'Ghost', 'Legend', 'Myth',
  'Hammer', 'Anvil', 'Forge', 'Sword', 'Shield', 'Arrow', 'Archer', 'Gunner', 'Pilot', 'Driver',
  'Explorer', 'Detective', 'Artist', 'Scholar', 'Genius', 'Champion', 'Hero', 'Villain', 'Jester', 'Oracle'
];

  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  const username = `${firstName.toLowerCase()}_${lastName.toLowerCase()}`;
  const domain = domains[0];

  // Generate random password meeting complexity requirements
  const password = generatePassword();

  return {
    name: username,
    given_name: firstName,
    surname: lastName,
    password: password,
    upn: `${username}@${domain}`,
    ou_path: 'CN=CloudSpace1,DC=ntnx,DC=local'
  };
}


function generatePassword() {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const allChars = uppercase + lowercase + numbers;

  // Ensure at least one character from each required set
  let password = [
    uppercase[Math.floor(Math.random() * uppercase.length)],
    lowercase[Math.floor(Math.random() * lowercase.length)],
    numbers[Math.floor(Math.random() * numbers.length)]
  ];

  // Fill the rest with random characters from all sets
  for (let i = 3; i < 8; i++) {
    password.push(allChars[Math.floor(Math.random() * allChars.length)]);
  }

  // Shuffle the password array to avoid predictable patterns
  for (let i = password.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [password[i], password[j]] = [password[j], password[i]];
  }

  return password.join('');
}

// Generate and save user data
const userData = generateRandomUser();
fs.writeFileSync('user_data.json', JSON.stringify(userData, null, 2));
console.log('Generated user data:', userData);
