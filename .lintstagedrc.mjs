const shellQuote = (file) => `'${file.replaceAll("'", "'\\''")}'`;

const formatWith = (formatter) => (files) =>
  `${formatter} ${files.map(shellQuote).join(" ")}`;

export default {
  "*.{cjs,css,cts,html,js,jsx,json,jsonc,md,mjs,mts,scss,ts,tsx,yaml,yml}":
    "prettier --write",
  "*.rs": formatWith("rustfmt --edition 2021"),
  "*.{c,cc,cpp,cxx,h,hh,hpp,hxx}": formatWith("clang-format -i"),
};
