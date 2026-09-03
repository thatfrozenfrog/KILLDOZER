#include <iostream>
#include <vector>
#include <array>
#include <cmath>
#include <algorithm>
#include <cstring>
#include <random>
#include <map>
#include <set>
#include <sstream>

using namespace std;
#define __stub() cerr << "STUB: " << __FILE__ << ":" << __LINE__ << endl;
#define nl "\n"


string moves[4] = {"Left", "Right", "Up", "Down"};
// fine-tune values
double weight_map[4][4] = {
    { 16, 32, 64, 128},
    { 64, 128, 256, 512},
    { 256, 512, 1024, 4096},
    { 65536, 16384, 4096, 1024}
};
double EMPTY_FACTOR = 2.5;
double SMOOTH_FACTOR = 0.1;
double WEIGHT_FACTOR = 1.0;
class board{
public:
    int grid[4][4];
    board(){
        memset(grid, 0, sizeof(grid));
    }
    board(const board &b){
        memcpy(grid, b.grid, sizeof(grid));
    }
    void dump(){
        for (int i=0;i<4;i++){
            for (int j=0;j<4;j++){
                cout << grid[i][j] << " ";
            }
            cout << nl;
        }
    }
    void transpose(){
        for (int i=0;i<4;i++){
            for (int j=i+1;j<4;j++){
                swap(grid[i][j], grid[j][i]);
            }
        }
    }
    void reverse(){
        for (int i=0;i<4;i++){
            for (int j=0;j<2;j++){
                swap(grid[i][j], grid[i][3-j]);
            }
        }
    }
    void move_left(){
        for (int i=0;i<4;i++){
            slide_left(i);
        }
    }

    bool lose() const{
        for (int i=0;i<4;i++) for(int j=0;j<4;j++){
            if (grid[i][j] ==0) return false;
            if (j+1<4 && grid[i][j] == grid[i][j+1]) return false;
            if (i+1<4 && grid[i][j] == grid[i+1][j]) return false;
        }
        return true;
    }
    bool operator== (const board &b) const{
        return memcmp(grid, b.grid, sizeof(grid)) == 0;
    }
    private:
    void slide_left(int row) {
        vector<int> tmp;
        for (int i = 0; i < 4; i++)
            if (grid[row][i]) tmp.push_back(grid[row][i]);

        vector<int> merged;
        int i = 0;
        while (i < (int)tmp.size()) {
            if (i + 1 < tmp.size() && tmp[i] == tmp[i + 1]) {
                merged.push_back(tmp[i] * 2);
                i += 2;
            } else {
                merged.push_back(tmp[i]);
                i++;
            }
        }

        while (merged.size() < 4) merged.push_back(0);
        for (int j = 0; j < 4; j++) grid[row][j] = merged[j];
    }
};

class evaluator{
    public:
        double evaluate(const board &b){
            double score = 0.0;
            int empty = 0;
            for (int i =0;i<4;i++) for(int j =0;j<4;j++){
                if (b.grid[i][j]==0) empty++;
            }
            double monoscore = mono(b);
            double smoothscore = smooth(b);
            return monoscore * WEIGHT_FACTOR + empty * EMPTY_FACTOR + smoothscore * SMOOTH_FACTOR;
        }
    private:
        double mono(const board &b){
            double score =0.0;
            for (int i=0;i<4;i++) for(int j=0;j<4;j++){
                score += b.grid[i][j] * weight_map[i][j];
            }
            return score;
        }
        double smooth(const board&b){
            double score = 0.0;
            for(int i = 0;i<4;i++) for(int j =0;j<4;j++){
                if (j+1<4){
                    if (b.grid[i][j] and b.grid[i][j+1]) score -= abs(b.grid[i][j] - b.grid[i][j+1]);
                }
            }
            for(int j = 0;j<4;j++) for(int i =0;i<4;i++){
                if (i+1<4){
                    if (b.grid[i][j] and b.grid[i+1][j]) score -= abs(b.grid[i][j] - b.grid[i+1][j]);
                }
            }
            return score;
        }
};


board mover(board b, int dir){
    switch (dir) {
        case 0: {
            b.move_left();
            return b;
        }
        case 1: {
            b.reverse();
            b.move_left();
            b.reverse();
            return b;
        }
        case 2:{
            b.transpose();
            b.move_left();
            b.transpose();
            return b;
        }
        case 3:{
            b.transpose();
            b.reverse();
            b.move_left();
            b.reverse();
            b.transpose();
            return b;
        }
        default: {
            return b;
        }
    }
}



double expectimax(const board &b, int depth, bool aut){
    if ((not depth) or (b.lose())) {
        return evaluator().evaluate(b);
    }
    
    if (aut){
        double best = -1e9;
        double scores[4];
        for (int dir = 0; dir < 4; dir++){
            board next = mover(b, dir);
            if (!(next==b)){
                double val = expectimax(next, depth -1, false);
                best = max(best, val);
                scores[dir] = val;
            }
        }
        return best;
    } else {
        double total = 0.0;
        int cnt =0;
        for (int i=0;i<4;i++) for(int j=0;j<4;j++){
            if (b.grid[i][j] ==0) cnt ++;
        }
        if (cnt ==0) return evaluator().evaluate(b);
        double prob = 1.0 / cnt;
        for (int i=0;i<4;i++) for(int j=0;j<4;j++){
            if (b.grid[i][j] ==0){
                board b2 = b;
                b2.grid[i][j] =2;
                total += (prob * expectimax(b2, depth -1, true));
            }
        }
        return total;
    }
}


int best_move(const board &b, int depth){
    double bestscore = -1e9;
    int bestdir = -1;
    for (int dir =0;dir<4;dir++){
        board next = mover(b, dir);
        if  (!(next==b)){
            double val = expectimax(next, depth -1, false);
            if (val > bestscore){
                bestscore = val;
                bestdir = dir;
            }
        }
    }
    return bestdir;
}

int best_depth(const board &b){
    int empty =0;
    for (int i=0;i<4;i++) for(int j=0;j<4;j++){
        if (b.grid[i][j]==0) empty++;
    }
    if (empty >= 8) return 4;
    if (empty >= 4) return 5;
    return 6;
}

namespace test{
    void movetest(board b){
        cout << "Move left:" << nl;
        board bl = mover(b, 0);
        bl.dump();
        cout << "Move right:" << nl;
        board br = mover(b, 1);
        br.dump();
        cout << "Move up:" << nl;
        board bu = mover(b, 2);
        bu.dump();
        cout << "Move down:" << nl;
        board bd = mover(b, 3);
        bd.dump();
    }
    void evaltest(board b){
        double val = evaluator().evaluate(b);
        cout << "Evaluation score: " << val << nl;
    }
}
signed main(){
    //cin.tie(0)->sync_with_stdio(0);
    board b;
    while (true){
        for (int i=0;i<4;i++){
            for (int j=0;j<4;j++){
                cin >> b.grid[i][j];
            }
        }
        cout << "Move: " << moves[best_move(b, best_depth(b))] << nl;
    }
}
// FOR EMCC ONLY
extern "C" {
    const char* solve_move(const char* input) {
        static string output; 

        board b;
        stringstream ss(input);
        for (int i = 0; i < 4; i++)
            for (int j = 0; j < 4; j++)
                ss >> b.grid[i][j];
        int dir = best_move(b, best_depth(b));
        output = moves[dir];
        return output.c_str();
    }
}